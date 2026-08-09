"""Post-LLM validation: price constraint, indicator veto, plan geometry.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/fast_analysis.py`
(`_validate_and_constrain`, `_validate_decision_against_indicators`,
`_finalize_trading_plan_for_decision`) and `safe_float_price` from
`.../fast_analysis_formatters.py`.

Same thresholds, the same +-10% entry clamp, the same 0.95/1.05 direction
defaults, the same rounding to 6 decimal places.

Changed on port:
  * Upstream appends a bracketed CHINESE sentence to `summary` whenever the
    veto fires ("[注意：技术指标显示...，建议观望]"). This service never
    rewrites `summary`: it reports machine-readable conflict codes in
    `AppliedAdjustments.indicator_conflicts` and lets `web/` render the
    sentence in the user's own language, which is the only way an
    Arabic-first product can carry this information honestly.
  * Numeric fields coming out of the model are coerced defensively
    (`_as_number`) instead of being passed straight to `int()`. Upstream
    raises on a null confidence and loses the whole analysis; here a
    nonsensical value falls back to the same neutral 50 the model was told to
    use, and the endpoint still answers.
  * `AppliedAdjustments` is new: upstream mutates in place and tells nobody.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.engine.analysis.models import TimeframeIndicators
from app.engine.analysis.scoring import indicators_present

VALID_DECISIONS = ("BUY", "SELL", "HOLD")

# Every price the model returns must sit inside +-10% of the live price.
PRICE_BOUND_RATIO = 0.10
# Fallback levels when the model's own stop/target are unusable. Named for
# where they sit relative to price rather than for their role, because the
# roles swap by direction: a long stops below and targets above, a short does
# the reverse.
BELOW_PRICE_RATIO = 0.95
ABOVE_PRICE_RATIO = 1.05
PRICE_ROUNDING = 6

# Below this the model is not confident enough to act on, whatever it said.
MIN_ACTIONABLE_CONFIDENCE = 60

# Conflict codes replacing upstream's Chinese conflict strings.
CONFLICT_RSI_OVERBOUGHT = "rsi_overbought"
CONFLICT_MACD_BEARISH = "macd_bearish"
CONFLICT_MA_DOWNTREND = "ma_downtrend"
CONFLICT_STRONG_BULLISH = "strong_bullish_signals"
CONFLICT_VERY_STRONG_UPTREND = "very_strong_uptrend"


@dataclass
class AppliedAdjustments:
    """Mutable bookkeeping of what the engine changed, mapped 1:1 onto the
    wire model of the same name in `app/engine/analysis/models.py`."""

    entry_clamped: bool = False
    stop_defaulted: bool = False
    take_profit_defaulted: bool = False
    decision_overridden_by: str | None = None
    confidence_adjusted_by: float = 0.0
    indicator_conflicts: list[str] = field(default_factory=list)


def safe_float_price(value: Any, default: float | None = None) -> float | None:
    """Port of `safe_float_price`: coerces "1,234.5" to 1234.5, rejects NaN,
    and returns `default` for anything it cannot read as a number."""
    if value is None:
        return default
    if isinstance(value, int | float):
        if isinstance(value, float) and value != value:  # NaN
            return default
        return float(value)
    try:
        text = str(value).strip().replace(",", "")
        if not text:
            return default
        return float(text)
    except (TypeError, ValueError):
        return default


def _as_number(value: Any, default: float) -> float:
    coerced = safe_float_price(value, None)
    return default if coerced is None else coerced


def validate_and_constrain(
    analysis: dict[str, Any],
    current_price: float,
    indicators: TimeframeIndicators | None,
    *,
    has_major_news: bool = False,
    has_macro_event: bool = False,
    applied: AppliedAdjustments,
) -> dict[str, Any]:
    """Port of `_validate_and_constrain`. Mutates and returns `analysis`."""
    if not current_price or current_price <= 0:
        return analysis

    min_price = current_price * (1 - PRICE_BOUND_RATIO)
    max_price = current_price * (1 + PRICE_BOUND_RATIO)
    decision = str(analysis.get("decision", "HOLD")).upper()

    entry = safe_float_price(analysis.get("entry_price"), current_price)
    if entry is not None and (entry < min_price or entry > max_price):
        # An entry outside the band is not a tradable idea, it is a typo.
        analysis["entry_price"] = round(current_price, PRICE_ROUNDING)
        applied.entry_clamped = True
    elif entry is not None:
        analysis["entry_price"] = round(entry, PRICE_ROUNDING)

    if decision == "SELL":
        # Short geometry: take_profit < current < stop_loss.
        stop_default = round(current_price * ABOVE_PRICE_RATIO, PRICE_ROUNDING)
        target_default = round(current_price * BELOW_PRICE_RATIO, PRICE_ROUNDING)
        stop_loss = safe_float_price(analysis.get("stop_loss"), stop_default)
        take_profit = safe_float_price(analysis.get("take_profit"), target_default)
        if stop_loss is None or stop_loss <= current_price or stop_loss > max_price:
            analysis["stop_loss"] = stop_default
            applied.stop_defaulted = True
        else:
            analysis["stop_loss"] = round(stop_loss, PRICE_ROUNDING)
        if take_profit is None or take_profit >= current_price or take_profit < min_price:
            analysis["take_profit"] = target_default
            applied.take_profit_defaulted = True
        else:
            analysis["take_profit"] = round(take_profit, PRICE_ROUNDING)
    else:
        # Long (and HOLD) geometry: stop_loss < current < take_profit.
        stop_default = round(current_price * BELOW_PRICE_RATIO, PRICE_ROUNDING)
        target_default = round(current_price * ABOVE_PRICE_RATIO, PRICE_ROUNDING)
        stop_loss = safe_float_price(analysis.get("stop_loss"), stop_default)
        take_profit = safe_float_price(analysis.get("take_profit"), target_default)
        if stop_loss is None or stop_loss < min_price or stop_loss >= current_price:
            analysis["stop_loss"] = stop_default
            applied.stop_defaulted = True
        else:
            analysis["stop_loss"] = round(stop_loss, PRICE_ROUNDING)
        if take_profit is None or take_profit <= current_price or take_profit > max_price:
            analysis["take_profit"] = target_default
            applied.take_profit_defaulted = True
        else:
            analysis["take_profit"] = round(take_profit, PRICE_ROUNDING)

    confidence = _as_number(analysis.get("confidence", 50), 50.0)
    analysis["confidence"] = max(0, min(100, int(confidence)))

    for score_key in ("technical_score", "fundamental_score", "sentiment_score"):
        analysis[score_key] = max(0, min(100, int(_as_number(analysis.get(score_key, 50), 50.0))))

    if decision not in VALID_DECISIONS:
        analysis["decision"] = "HOLD"
    else:
        analysis["decision"] = decision

    if indicators is not None and indicators_present(indicators):
        # Note the unclamped `confidence` here: upstream passes the raw value
        # it read, not the 0..100 version it just wrote back.
        analysis = validate_decision_against_indicators(
            analysis,
            indicators,
            confidence,
            has_major_news=has_major_news,
            has_macro_event=has_macro_event,
            applied=applied,
        )

    stop_before = analysis.get("stop_loss")
    target_before = analysis.get("take_profit")
    analysis = finalize_trading_plan_for_decision(analysis, current_price, indicators)
    if analysis.get("stop_loss") != stop_before:
        applied.stop_defaulted = True
    if analysis.get("take_profit") != target_before:
        applied.take_profit_defaulted = True

    return analysis


def validate_decision_against_indicators(
    analysis: dict[str, Any],
    indicators: TimeframeIndicators,
    confidence: float,
    *,
    has_major_news: bool = False,
    has_macro_event: bool = False,
    applied: AppliedAdjustments,
) -> dict[str, Any]:
    """Port of `_validate_decision_against_indicators`.

    A major news or macro event is allowed to outrank the indicators — it
    costs confidence instead of the decision. Without one, a decision that
    fights its own indicators becomes HOLD.
    """
    decision = str(analysis.get("decision", "HOLD"))
    rsi_value = (
        indicators.rsi.value if indicators.rsi and indicators.rsi.value is not None else 50.0
    )
    macd_signal = (
        indicators.macd.signal
        if indicators.macd and indicators.macd.signal is not None
        else "neutral"
    )
    ma_trend = (
        indicators.moving_averages.trend
        if indicators.moving_averages and indicators.moving_averages.trend is not None
        else "sideways"
    )
    ma_trend_low = ma_trend.lower()

    if confidence < MIN_ACTIONABLE_CONFIDENCE:
        if decision != "HOLD":
            analysis["decision"] = "HOLD"
            analysis["confidence"] = max(confidence, 45)
            applied.decision_overridden_by = "indicators"
        return analysis

    allow_override = has_major_news or has_macro_event
    conflicts: list[str] = []

    if decision == "BUY":
        if rsi_value > 70:
            conflicts.append(CONFLICT_RSI_OVERBOUGHT)
        if macd_signal == "bearish":
            conflicts.append(CONFLICT_MACD_BEARISH)
        if "strong_downtrend" in ma_trend_low or (
            "downtrend" in ma_trend_low and rsi_value > 50
        ):
            conflicts.append(CONFLICT_MA_DOWNTREND)
    elif decision == "SELL":
        if rsi_value < 30 and macd_signal == "bullish" and "uptrend" in ma_trend_low:
            conflicts.append(CONFLICT_STRONG_BULLISH)
        elif rsi_value < 30 and "strong_uptrend" in ma_trend_low:
            conflicts.append(CONFLICT_VERY_STRONG_UPTREND)

    if conflicts:
        applied.indicator_conflicts.extend(conflicts)
        if allow_override:
            analysis["confidence"] = max(confidence - 15, 50)
        else:
            analysis["decision"] = "HOLD"
            analysis["confidence"] = max(confidence - 20, 40)
            applied.decision_overridden_by = "indicators"

    return analysis


def finalize_trading_plan_for_decision(
    analysis: dict[str, Any], current_price: float, indicators: TimeframeIndicators | None
) -> dict[str, Any]:
    """Port of `_finalize_trading_plan_for_decision`.

    The pre-computed `suggested_stop_loss`/`suggested_take_profit` are long
    levels. For a SELL they are mirrored around the current price rather than
    used as-is, so a short never inherits a stop below the market.
    """
    if not current_price or current_price <= 0:
        return analysis
    decision = str(analysis.get("decision", "HOLD")).upper()
    if decision not in ("BUY", "SELL"):
        return analysis

    min_price = current_price * (1 - PRICE_BOUND_RATIO)
    max_price = current_price * (1 + PRICE_BOUND_RATIO)
    eps = max(abs(current_price) * 1e-6, 1e-8)

    long_stop = safe_float_price(indicators.suggested_stop_loss) if indicators else None
    long_target = safe_float_price(indicators.suggested_take_profit) if indicators else None
    # Bundled into one optional pair so both branches below get a usable pair
    # or nothing at all — there is no half-valid level set.
    long_levels: tuple[float, float] | None = None
    if (
        long_stop is not None
        and long_target is not None
        and long_stop < current_price - eps
        and long_target > current_price + eps
    ):
        long_levels = (long_stop, long_target)

    if decision == "SELL":
        if long_levels is not None:
            mirrored_stop = round(2 * current_price - long_levels[0], PRICE_ROUNDING)
            mirrored_target = round(2 * current_price - long_levels[1], PRICE_ROUNDING)
            mirrored_stop = min(max(mirrored_stop, current_price + eps), max_price)
            mirrored_target = max(min(mirrored_target, current_price - eps), min_price)
            if mirrored_stop > current_price and mirrored_target < current_price:
                analysis["stop_loss"] = mirrored_stop
                analysis["take_profit"] = mirrored_target
            else:
                analysis["stop_loss"] = round(
                    min(max_price, current_price * ABOVE_PRICE_RATIO), PRICE_ROUNDING
                )
                analysis["take_profit"] = round(
                    max(min_price, current_price * BELOW_PRICE_RATIO), PRICE_ROUNDING
                )
        else:
            stop = safe_float_price(analysis.get("stop_loss"))
            target = safe_float_price(analysis.get("take_profit"))
            if stop is not None and target is not None and target < current_price < stop:
                analysis["stop_loss"] = round(
                    min(max(stop, current_price + eps), max_price), PRICE_ROUNDING
                )
                analysis["take_profit"] = round(
                    max(min(target, current_price - eps), min_price), PRICE_ROUNDING
                )
            else:
                analysis["stop_loss"] = round(
                    min(max_price, current_price * ABOVE_PRICE_RATIO), PRICE_ROUNDING
                )
                analysis["take_profit"] = round(
                    max(min_price, current_price * BELOW_PRICE_RATIO), PRICE_ROUNDING
                )
    else:
        if long_levels is not None:
            analysis["stop_loss"] = round(
                max(min(long_levels[0], current_price - eps), min_price), PRICE_ROUNDING
            )
            analysis["take_profit"] = round(
                min(max(long_levels[1], current_price + eps), max_price), PRICE_ROUNDING
            )
        else:
            stop = safe_float_price(analysis.get("stop_loss"))
            target = safe_float_price(analysis.get("take_profit"))
            if stop is not None and target is not None and stop < current_price < target:
                analysis["stop_loss"] = round(
                    max(min(stop, current_price - eps), min_price), PRICE_ROUNDING
                )
                analysis["take_profit"] = round(
                    min(max(target, current_price + eps), max_price), PRICE_ROUNDING
                )
            else:
                analysis["stop_loss"] = round(
                    max(min_price, current_price * BELOW_PRICE_RATIO), PRICE_ROUNDING
                )
                analysis["take_profit"] = round(
                    min(max_price, current_price * ABOVE_PRICE_RATIO), PRICE_ROUNDING
                )

    # Last resort: whatever happened above, never ship inverted geometry.
    stop = safe_float_price(analysis.get("stop_loss"), current_price)
    target = safe_float_price(analysis.get("take_profit"), current_price)
    if stop is None or target is None:
        return analysis
    if decision == "SELL":
        if not target < current_price < stop:
            analysis["stop_loss"] = round(
                min(max_price, current_price * ABOVE_PRICE_RATIO), PRICE_ROUNDING
            )
            analysis["take_profit"] = round(
                max(min_price, current_price * BELOW_PRICE_RATIO), PRICE_ROUNDING
            )
    else:
        if not stop < current_price < target:
            analysis["stop_loss"] = round(
                max(min_price, current_price * BELOW_PRICE_RATIO), PRICE_ROUNDING
            )
            analysis["take_profit"] = round(
                min(max_price, current_price * ABOVE_PRICE_RATIO), PRICE_ROUNDING
            )

    return analysis


def adjust_position_size(
    analysis: dict[str, Any], *, agreement: float, multiplier: float
) -> dict[str, Any]:
    """Port of the post-validation position-size scaling.

    Size shrinks with poor data quality and with timeframe disagreement, and
    a HOLD keeps only a quarter of what is left.
    """
    size = int(_as_number(analysis.get("position_size_pct", 10), 10.0) or 10.0)
    agreement_scale = 0.6 + 0.4 * agreement
    scaled = size * multiplier * agreement_scale
    if str(analysis.get("decision") or "").upper() == "HOLD":
        scaled *= 0.25
    analysis["position_size_pct"] = max(1, min(100, int(round(scaled))))
    return analysis
