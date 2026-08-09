"""Objective scoring: technical, fundamental, sentiment, macro, crypto factors.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/fast_analysis_scoring.py`
(`FastAnalysisScoringMixin._calculate_objective_score`,
`_technical_risk_context`, `_calculate_technical_score`,
`_calculate_fundamental_score`, `_calculate_crypto_factor_score`,
`_calculate_sentiment_score`, `_calculate_macro_score`) and
`.../fast_analysis.py` (`_detect_market_regime`).

Every weight, band, cap and clamp below is upstream's, reproduced to the
digit — including two behaviours that look like bugs and are not being
"fixed" here, because the whole point of the port is that the numbers match:

  * the "extra" bucket accumulates `extra_weight` but only ever uses it as a
    boolean gate — the weight that actually enters `weight_sum` is the fixed
    0.15;
  * the final divisor is `max(1.0, weight_sum)`, so a partial component set
    (RSI skipped, weight_sum 0.85) is divided by 1.0, not by 0.85.

Changed on port:
  * Inputs are the typed `TimeframeIndicators` model instead of nested dicts,
    and read the flattened `change_24h` / `volatility_pct` / `bollinger.upper`
    spellings the bridge contract froze (upstream: `price["changePercent"]`,
    `indicators["volatility"]["pct"]`, `indicators["bollinger"]["BB_upper"]`).
    Each read reproduces its own upstream default exactly — `.get(k, default)`
    and `x or default` are NOT interchangeable and are kept apart below.
  * The geopolitical news classifier (`fast_analysis_geo.py`'s regex ladder)
    is not ported. Classifying news TEXT belongs on the side of the split that
    has the text: `web/` collects news, so `web/` tags each item with
    `geopolitical_level` and this service applies upstream's exact penalty
    arithmetic (-42 severe, -18 moderate, cumulative floor -55).
  * `_get_ai_calibration`'s DB-backed thresholds are not ported — this service
    has no calibration table, so the decision thresholds are upstream's own
    defaults as constants in `app/engine/analysis/consensus.py`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.engine.analysis.models import TimeframeIndicators

# Objective weights over PRESENT components only (upstream `weights` dict).
OBJECTIVE_WEIGHTS: dict[str, float] = {
    "technical": 0.35,
    "fundamental": 0.20,
    "sentiment": 0.25,
    "macro": 0.20,
}

# Markets whose `fundamental` payload is a real balance sheet rather than the
# hard-coded blurb upstream substitutes for crypto.
EQUITY_MARKETS = ("USStock", "CNStock", "HKStock")

# The keys that make a fundamental payload "meaningful" enough to weigh.
FUNDAMENTAL_MEANINGFUL_KEYS = (
    "pe_ratio",
    "pb_ratio",
    "ps_ratio",
    "market_cap",
    "roe",
    "eps",
    "revenue_growth",
    "profit_margin",
    "dividend_yield",
)

# Upstream returns 50.0, not 0.0, when there is nothing to value: a neutral
# score, not an absence.
FUNDAMENTAL_NEUTRAL_SCORE = 50.0

# Sentiment: only the newest 15 items are scanned, penalties are capped in
# aggregate, and the base score is the net positive/negative ratio times 60.
SENTIMENT_NEWS_SCAN_LIMIT = 15
SENTIMENT_BASE_SCALE = 60.0
SENTIMENT_GEO_PENALTY_CAP = -55
GEO_PENALTY_DELTA: dict[str, int] = {"severe": -42, "moderate": -18}

# Macro normalises against a constant, not against the factors it found.
MACRO_MAX_POSSIBLE = 125.0


@dataclass(frozen=True)
class RiskContext:
    """Is an oversold reading a bounce setup or the middle of a breakdown?

    `bearish_context` and `panic_breakdown` gate most of the caps in the
    technical score and both horizon clamps in the trend outlook.
    """

    trend: str
    macd_signal: str
    rsi: float
    change_24h: float
    volume_ratio: float
    downtrend: bool
    strong_downtrend: bool
    bearish_context: bool
    panic_breakdown: bool


@dataclass(frozen=True)
class CryptoFactorScore:
    score: float
    breakdown: list[dict[str, Any]]
    summary: str


@dataclass(frozen=True)
class ObjectiveScore:
    """All components on -100..+100. `*_present` says whether the component
    carried any weight in `overall_score`, which is what lets the API report
    an absent input as `null` instead of as a zero."""

    technical_score: float
    fundamental_score: float
    sentiment_score: float
    macro_score: float
    overall_score: float
    crypto_factor_score: float
    technical_present: bool
    fundamental_present: bool
    sentiment_present: bool
    macro_present: bool


def _as_float(value: object, default: float) -> float:
    """Coerce a value out of an untyped `web/`-supplied dict.

    Upstream leans on Python's duck typing here and raises on a bad type; the
    endpoint would rather score the inputs it can read than 500 on one stray
    string, so a value that cannot be a number falls back to `default`.
    """
    if isinstance(value, bool):
        return default
    if isinstance(value, int | float):
        return default if value != value else float(value)  # NaN check
    try:
        return float(str(value).strip().replace(",", ""))
    except (TypeError, ValueError):
        return default


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    coerced = _as_float(value, float("nan"))
    return None if coerced != coerced else coerced


def indicators_present(indicators: TimeframeIndicators) -> bool:
    """Upstream's `bool(indicators)` — an all-empty snapshot means the
    collector produced nothing for that timeframe."""
    return bool(indicators.model_dump(exclude_none=True))


def technical_risk_context(indicators: TimeframeIndicators) -> RiskContext:
    """Port of `_technical_risk_context`.

    Note the read order: `moving_averages.trend` wins over the flat `trend`
    here, which is the opposite of the volume branch in the technical score.
    """
    ma_trend = indicators.moving_averages.trend if indicators.moving_averages else None
    trend = str(ma_trend or indicators.trend or "sideways").lower()
    macd_signal = str((indicators.macd.signal if indicators.macd else None) or "neutral").lower()
    change_24h = indicators.change_24h or 0.0
    volume_ratio = indicators.volume_ratio or 1.0
    rsi_value = (indicators.rsi.value if indicators.rsi else None) or 50.0

    strong_downtrend = "strong_downtrend" in trend
    downtrend = "downtrend" in trend
    bearish_context = bool(downtrend or macd_signal == "bearish")
    panic_breakdown = bool(
        (strong_downtrend and macd_signal == "bearish" and change_24h <= -3.0)
        or (downtrend and macd_signal == "bearish" and change_24h <= -5.0)
        or (change_24h <= -8.0 and volume_ratio >= 1.3)
    )
    return RiskContext(
        trend=trend,
        macd_signal=macd_signal,
        rsi=rsi_value,
        change_24h=change_24h,
        volume_ratio=volume_ratio,
        downtrend=downtrend,
        strong_downtrend=strong_downtrend,
        bearish_context=bearish_context,
        panic_breakdown=panic_breakdown,
    )


def detect_market_regime(indicators: TimeframeIndicators) -> str:
    """Port of `_detect_market_regime`: "trending" | "ranging"."""
    ma_trend = indicators.moving_averages.trend if indicators.moving_averages else None
    trend = str(ma_trend or "sideways").lower()
    if "uptrend" in trend or "downtrend" in trend or "strong" in trend:
        return "trending"
    return "ranging"


def calculate_technical_score(indicators: TimeframeIndicators) -> float:
    """Port of `_calculate_technical_score`. -100..+100."""
    score = 0.0
    weight_sum = 0.0
    risk = technical_risk_context(indicators)

    # --- RSI, weight 0.30 -------------------------------------------------
    # `.get("value", 50)`: a snapshot with no RSI still contributes its weight
    # at a neutral 50 (score 0). A reported 0 means "no reading" and is skipped
    # entirely by the `> 0` gate, which is why weight_sum can fall below 1.0.
    rsi_value = (
        indicators.rsi.value if indicators.rsi and indicators.rsi.value is not None else 50.0
    )
    if rsi_value > 0:
        if rsi_value > 70:
            rsi_score = -50.0
        elif rsi_value > 60:
            rsi_score = -30.0
        elif rsi_value < 30:
            rsi_score = 50.0
        elif rsi_value < 40:
            rsi_score = 30.0
        else:
            rsi_score = (50 - rsi_value) * 0.6
        # Oversold inside a breakdown is continuation risk, not a bounce.
        if rsi_value < 30:
            if risk.panic_breakdown:
                rsi_score = -10.0
            elif risk.bearish_context:
                rsi_score = min(rsi_score, 8.0)
        elif rsi_value < 40 and risk.bearish_context:
            rsi_score = min(rsi_score, 6.0)
        score += rsi_score * 0.30
        weight_sum += 0.30

    # --- MACD, weight 0.25 ------------------------------------------------
    macd_signal = (
        indicators.macd.signal
        if indicators.macd and indicators.macd.signal is not None
        else "neutral"
    )
    if macd_signal == "bullish":
        macd_score = 40.0
    elif macd_signal == "bearish":
        macd_score = -40.0
    else:
        macd_score = 0.0
    score += macd_score * 0.25
    weight_sum += 0.25

    # --- Moving-average trend, weight 0.25 --------------------------------
    ma_trend = (
        indicators.moving_averages.trend
        if indicators.moving_averages and indicators.moving_averages.trend is not None
        else "sideways"
    )
    ma_trend_low = ma_trend.lower()
    if "strong_uptrend" in ma_trend_low:
        ma_score = 40.0
    elif "uptrend" in ma_trend_low:
        ma_score = 25.0
    elif "strong_downtrend" in ma_trend_low:
        ma_score = -40.0
    elif "downtrend" in ma_trend_low:
        ma_score = -25.0
    else:
        ma_score = 0.0
    score += ma_score * 0.25
    weight_sum += 0.25

    # --- 24h change, weight 0.20 ------------------------------------------
    change_24h = indicators.change_24h if indicators.change_24h is not None else 0.0
    if change_24h > 10:
        change_score = -20.0
    elif change_24h > 5:
        change_score = -10.0
    elif change_24h < -10:
        change_score = 20.0
    elif change_24h < -5:
        change_score = 10.0
    else:
        change_score = change_24h * 2
    # A big drop is only a "buy the dip" signal outside a breakdown.
    if change_24h < -10:
        change_score = (
            -20.0
            if risk.panic_breakdown
            else (min(change_score, 5.0) if risk.bearish_context else change_score)
        )
    elif change_24h < -5:
        change_score = (
            -10.0
            if risk.panic_breakdown
            else (min(change_score, 3.0) if risk.bearish_context else change_score)
        )
    score += change_score * 0.20
    weight_sum += 0.20

    # --- "extra" bucket: price position, Bollinger, volume ----------------
    # `extra_weight` is accumulated exactly as upstream does, and — exactly as
    # upstream does — is only ever read as `> 0`. The weight that reaches
    # `weight_sum` is the fixed 0.15 below, whatever the bucket collected.
    extra_score = 0.0
    extra_weight = 0.0

    price_position = (
        indicators.price_position if indicators.price_position is not None else 50.0
    )
    pp_score = (50.0 - price_position) * 0.3
    if price_position >= 85:
        pp_score -= 5
    elif price_position <= 15:
        pp_score += 5
    if risk.bearish_context and price_position <= 20:
        pp_score = min(pp_score, 3.0)
    if risk.panic_breakdown and price_position <= 20:
        pp_score = min(pp_score, -3.0)
    extra_score += pp_score
    extra_weight += 0.20

    current_price = indicators.current_price or 0.0
    bb_upper = (indicators.bollinger.upper if indicators.bollinger else None) or 0.0
    bb_lower = (indicators.bollinger.lower if indicators.bollinger else None) or 0.0
    if current_price > 0 and bb_upper > 0 and bb_lower > 0 and bb_upper > bb_lower:
        if current_price >= bb_upper:
            extra_score += -12
            extra_weight += 0.20
        elif current_price <= bb_lower:
            extra_score += (
                -6 if risk.panic_breakdown else (0 if risk.bearish_context else 12)
            )
            extra_weight += 0.20
        else:
            relative = (current_price - bb_lower) / (bb_upper - bb_lower)
            extra_score += (0.5 - relative) * 10
            extra_weight += 0.10

    volume_ratio = indicators.volume_ratio or 1.0
    # Reverse of the risk-context read order: the flat `trend` wins here.
    volume_trend = str(
        indicators.trend
        or (indicators.moving_averages.trend if indicators.moving_averages else None)
        or ""
    ).lower()
    if volume_ratio >= 1.8:
        if "uptrend" in volume_trend:
            extra_score += 8
            extra_weight += 0.15
        elif "downtrend" in volume_trend:
            extra_score += -16 if risk.change_24h < 0 else -8
            extra_weight += 0.15
        else:
            extra_score += -3
            extra_weight += 0.10
    elif volume_ratio <= 0.6:
        extra_score += 0
        extra_weight += 0.05

    # Volatility damping: wide bars make every one of the readings above
    # noisier, so both the bucket and the running score are shrunk.
    volatility_pct = indicators.volatility_pct or 0.0
    if volatility_pct >= 6.0:
        extra_score *= 0.6
        score *= 0.92
    elif volatility_pct >= 3.5:
        extra_score *= 0.8
        score *= 0.96

    if extra_weight > 0:
        extra_norm = max(-100.0, min(100.0, extra_score))
        score += extra_norm * 0.15
        weight_sum += 0.15

    if weight_sum > 0:
        # `max(1.0, ...)`: the divisor never drops below 1, so a component set
        # lighter than 1.0 is damped rather than amplified.
        score = score / max(1.0, weight_sum)
    if risk.panic_breakdown:
        score = min(score, -25.0)
    elif risk.bearish_context and risk.change_24h <= -3.0:
        score = min(score, 5.0)

    return max(-100.0, min(100.0, score))


def _fundamental_meaningful(fundamental: dict[str, Any] | None) -> bool:
    if not fundamental:
        return False
    for key in FUNDAMENTAL_MEANINGFUL_KEYS:
        value = fundamental.get(key)
        if value is None or value == "":
            continue
        if isinstance(value, float) and value != value:  # NaN
            continue
        return True
    return False


def calculate_fundamental_score(fundamental: dict[str, Any] | None, market: str) -> float:
    """Port of `_calculate_fundamental_score`. -100..+100, neutral 50.0.

    The `/ factors * 100 / 4` normalisation is a mean times 25, so a single
    strong factor saturates the clamp — upstream behaviour, kept.
    """
    if market not in EQUITY_MARKETS or not fundamental:
        return FUNDAMENTAL_NEUTRAL_SCORE

    score = 0.0
    factors = 0

    pe_ratio = _optional_float(fundamental.get("pe_ratio"))
    if pe_ratio and pe_ratio > 0:
        if pe_ratio < 15:
            pe_score = 20.0
        elif pe_ratio < 25:
            pe_score = 10.0
        elif pe_ratio > 50:
            pe_score = -20.0
        elif pe_ratio > 35:
            pe_score = -10.0
        else:
            pe_score = 0.0
        score += pe_score
        factors += 1

    roe = _optional_float(fundamental.get("roe"))
    if roe:
        if roe > 20:
            roe_score = 20.0
        elif roe > 15:
            roe_score = 10.0
        elif roe < 5:
            roe_score = -20.0
        elif roe < 10:
            roe_score = -10.0
        else:
            roe_score = 0.0
        score += roe_score
        factors += 1

    revenue_growth = _optional_float(fundamental.get("revenue_growth"))
    if revenue_growth:
        if revenue_growth > 20:
            growth_score = 20.0
        elif revenue_growth > 10:
            growth_score = 10.0
        elif revenue_growth < -10:
            growth_score = -20.0
        elif revenue_growth < 0:
            growth_score = -10.0
        else:
            growth_score = 0.0
        score += growth_score
        factors += 1

    profit_margin = _optional_float(fundamental.get("profit_margin"))
    if profit_margin:
        if profit_margin > 20:
            margin_score = 15.0
        elif profit_margin > 10:
            margin_score = 7.0
        elif profit_margin < 0:
            margin_score = -15.0
        elif profit_margin < 5:
            margin_score = -7.0
        else:
            margin_score = 0.0
        score += margin_score
        factors += 1

    debt_to_equity = _optional_float(fundamental.get("debt_to_equity"))
    if debt_to_equity:
        if debt_to_equity < 0.5:
            debt_score = 10.0
        elif debt_to_equity > 2.0:
            debt_score = -10.0
        else:
            debt_score = 0.0
        score += debt_score
        factors += 1

    if factors > 0:
        score = score / factors * 100 / 4
    else:
        return FUNDAMENTAL_NEUTRAL_SCORE

    return max(-100.0, min(100.0, score))


def calculate_crypto_factor_score(
    crypto_factors: dict[str, Any] | None, change_24h: float | None
) -> CryptoFactorScore:
    """Port of `_calculate_crypto_factor_score`.

    AiChart has no crypto derivatives feed today (`web/` rejects non-forex
    markets outright), so in practice `crypto_factors` arrives as `None` and
    this returns a zero with an empty breakdown. Ported anyway so the crypto
    branch of the objective score is not a hole if that ever changes.
    """
    if not crypto_factors:
        return CryptoFactorScore(score=0.0, breakdown=[], summary="")

    breakdown: list[dict[str, Any]] = []
    score = 0.0

    def add(name: str, value: float, reason: str) -> None:
        nonlocal score
        score += value
        breakdown.append({"factor": name, "score": round(value, 2), "reason": reason})

    funding_rate = _optional_float(crypto_factors.get("funding_rate"))
    oi_change = _optional_float(crypto_factors.get("open_interest_change_24h"))
    if funding_rate is not None and oi_change is not None:
        if funding_rate > 0 and oi_change > 3:
            add(
                "funding_oi",
                18,
                "Positive funding with rising open interest strengthens long momentum.",
            )
        elif funding_rate < 0 and oi_change > 3:
            add(
                "funding_oi",
                -18,
                "Negative funding with rising open interest strengthens short momentum.",
            )

    exchange_netflow = _optional_float(crypto_factors.get("exchange_netflow"))
    if exchange_netflow is not None:
        if exchange_netflow < 0:
            add(
                "exchange_netflow",
                16,
                "Exchange net outflow indicates reduced immediate sell-side supply.",
            )
        elif exchange_netflow > 0:
            add(
                "exchange_netflow",
                -16,
                "Exchange net inflow indicates higher potential sell pressure.",
            )

    stablecoin_netflow = _optional_float(crypto_factors.get("stablecoin_netflow"))
    if stablecoin_netflow is not None:
        if stablecoin_netflow > 0:
            add(
                "stablecoin_netflow",
                12,
                "Stablecoin net inflow indicates stronger potential buying power.",
            )
        elif stablecoin_netflow < 0:
            add(
                "stablecoin_netflow",
                -12,
                "Stablecoin net outflow indicates weaker marginal buying power.",
            )

    long_short_ratio = _optional_float(crypto_factors.get("long_short_ratio"))
    if long_short_ratio is not None:
        if long_short_ratio > 1.6:
            add(
                "long_short_ratio",
                -10,
                "An overheated long-short ratio indicates crowded long positioning.",
            )
        elif long_short_ratio < 0.75:
            add(
                "long_short_ratio",
                8,
                "Deep short positioning creates potential for a short squeeze.",
            )

    volume_change = _optional_float(crypto_factors.get("volume_change_24h"))
    if volume_change is not None and change_24h is not None:
        if volume_change > 15 and change_24h > 0:
            add("volume_price", 10, "Rising price with strong volume confirms the trend.")
        elif volume_change > 15 and change_24h < 0:
            add("volume_price", -10, "Falling price with strong volume confirms bearish control.")
        elif volume_change < -15 and abs(change_24h) > 3:
            add(
                "volume_price",
                -6 if change_24h > 0 else 6,
                "Price movement with declining volume weakens trend confidence.",
            )

    signals = crypto_factors.get("signals") or {}
    squeeze_risk = str((signals.get("squeeze_risk") if isinstance(signals, dict) else "") or "")
    squeeze_risk = squeeze_risk.lower()
    if squeeze_risk == "high":
        add("squeeze_risk", -8, "High derivatives crowding increases short-term volatility risk.")
    elif squeeze_risk == "medium":
        add("squeeze_risk", -3, "Rising derivatives crowding calls for tighter risk control.")

    return CryptoFactorScore(
        score=max(-100.0, min(100.0, score)),
        breakdown=breakdown,
        summary=str(crypto_factors.get("summary") or ""),
    )


def calculate_sentiment_score(news: list[dict[str, Any]] | None) -> float:
    """Port of `_calculate_sentiment_score`.

    `geopolitical_level` ("severe" | "moderate" | anything else) is set by
    `web/`, which is where the headline text lives; the deltas, the cumulative
    -55 floor and the `is_global_event` promotion to "moderate" are upstream's.
    """
    if not news:
        return 0.0

    positive_count = 0
    negative_count = 0
    neutral_count = 0
    geopolitical_penalty = 0

    for item in news[:SENTIMENT_NEWS_SCAN_LIMIT]:
        level = str(item.get("geopolitical_level") or "none").lower()
        if level not in GEO_PENALTY_DELTA:
            level = "none"
        if item.get("is_global_event") and level == "none":
            level = "moderate"

        if level != "none":
            delta = GEO_PENALTY_DELTA[level]
            if geopolitical_penalty + delta < SENTIMENT_GEO_PENALTY_CAP:
                delta = SENTIMENT_GEO_PENALTY_CAP - geopolitical_penalty
            geopolitical_penalty += delta

        sentiment = item.get("sentiment", "neutral")
        if sentiment == "positive":
            positive_count += 1
        elif sentiment == "negative":
            negative_count += 1
        else:
            neutral_count += 1

    total = positive_count + negative_count + neutral_count
    if total > 0:
        base_score = (positive_count - negative_count) / total * SENTIMENT_BASE_SCALE
    else:
        base_score = 0.0

    return max(-100.0, min(100.0, base_score + geopolitical_penalty))


def calculate_macro_score(macro: dict[str, Any] | None, market: str) -> float:
    """Port of `_calculate_macro_score`.

    AiChart has no VIX/DXY/TNX feed today, so `macro` normally arrives as
    `None` and this returns 0.0 with `macro_present=False` — reported as an
    absent component, never as a calm-macro zero.
    """
    if not macro:
        return 0.0

    score = 0.0
    factors = 0

    vix = macro.get("VIX") or {}
    vix_value = _as_float(vix.get("price", 0), 0.0) if isinstance(vix, dict) else 0.0
    if vix_value > 0:
        if vix_value > 35:
            vix_score = -50.0
        elif vix_value > 30:
            vix_score = -40.0
        elif vix_value > 25:
            vix_score = -30.0
        elif vix_value > 20:
            vix_score = -15.0
        elif vix_value < 12:
            vix_score = 20.0
        elif vix_value < 15:
            vix_score = 10.0
        else:
            vix_score = 0.0
        score += vix_score
        factors += 1

    dxy = macro.get("DXY") or {}
    dxy_value = _as_float(dxy.get("price", 0), 0.0) if isinstance(dxy, dict) else 0.0
    dxy_change = _as_float(dxy.get("changePercent", 0), 0.0) if isinstance(dxy, dict) else 0.0
    if dxy_value > 0:
        if market in ("Crypto", "Forex", "Futures"):
            if dxy_change > 2:
                dxy_score = -30.0
            elif dxy_change > 1:
                dxy_score = -20.0
            elif dxy_change < -2:
                dxy_score = 30.0
            elif dxy_change < -1:
                dxy_score = 20.0
            else:
                dxy_score = 0.0
        else:
            if dxy_change > 2:
                dxy_score = -10.0
            elif dxy_change < -2:
                dxy_score = 10.0
            else:
                dxy_score = 0.0
        score += dxy_score
        factors += 1

    tnx = macro.get("TNX") or {}
    tnx_change = _as_float(tnx.get("changePercent", 0), 0.0) if isinstance(tnx, dict) else 0.0
    tnx_value = _as_float(tnx.get("price", 0), 0.0) if isinstance(tnx, dict) else 0.0
    if tnx_change != 0 or tnx_value > 0:
        if market in ("Crypto", "USStock"):
            if tnx_change > 3:
                tnx_score = -30.0
            elif tnx_change > 2:
                tnx_score = -20.0
            elif tnx_change < -3:
                tnx_score = 30.0
            elif tnx_change < -2:
                tnx_score = 20.0
            else:
                tnx_score = 0.0
        else:
            tnx_score = 0.0
        score += tnx_score
        factors += 1

    fear_greed = macro.get("FEAR_GREED") or {}
    fg_value = (
        _as_float(fear_greed.get("price", 0), 0.0) if isinstance(fear_greed, dict) else 0.0
    )
    if fg_value > 0 and market == "Crypto":
        if fg_value >= 80:
            score += -15
            factors += 1
        elif fg_value >= 65:
            score += -8
            factors += 1
        elif fg_value <= 20:
            score += 10
            factors += 1
        elif fg_value <= 35:
            score += 5
            factors += 1

    if factors > 0:
        # The divisor is the constant 125, not the factor count: `factors`
        # only gates whether normalisation happens at all.
        score = score / MACRO_MAX_POSSIBLE * 100

    return max(-100.0, min(100.0, score))


def calculate_objective_score(
    *,
    market: str,
    indicators: TimeframeIndicators,
    fundamental: dict[str, Any] | None = None,
    news: list[dict[str, Any]] | None = None,
    macro: dict[str, Any] | None = None,
    crypto_factors: dict[str, Any] | None = None,
) -> ObjectiveScore:
    """Port of `_calculate_objective_score`: a weighted mean over the
    components that are actually PRESENT, never over a padded full set."""
    technical_score = calculate_technical_score(indicators)
    fundamental_score = calculate_fundamental_score(fundamental, market)
    crypto = calculate_crypto_factor_score(crypto_factors, indicators.change_24h)
    if market.strip() == "Crypto" and crypto_factors:
        fundamental_score = crypto.score
    sentiment_score = calculate_sentiment_score(news)
    macro_score = calculate_macro_score(macro, market)

    technical_present = indicators_present(indicators)
    fundamental_present = market in EQUITY_MARKETS and _fundamental_meaningful(fundamental)
    if market == "Crypto" and crypto_factors:
        fundamental_present = True
    sentiment_present = bool(news)
    macro_present = bool(macro)

    present = {
        "technical": technical_present,
        "fundamental": fundamental_present,
        "sentiment": sentiment_present,
        "macro": macro_present,
    }
    total_weight = sum(w for key, w in OBJECTIVE_WEIGHTS.items() if present[key])
    if total_weight <= 0:
        overall_score = technical_score
    else:
        overall_score = (
            (technical_score * OBJECTIVE_WEIGHTS["technical"] if technical_present else 0.0)
            + (fundamental_score * OBJECTIVE_WEIGHTS["fundamental"] if fundamental_present else 0.0)
            + (sentiment_score * OBJECTIVE_WEIGHTS["sentiment"] if sentiment_present else 0.0)
            + (macro_score * OBJECTIVE_WEIGHTS["macro"] if macro_present else 0.0)
        ) / total_weight

    return ObjectiveScore(
        technical_score=technical_score,
        fundamental_score=fundamental_score,
        sentiment_score=sentiment_score,
        macro_score=macro_score,
        overall_score=overall_score,
        crypto_factor_score=crypto.score,
        technical_present=technical_present,
        fundamental_present=fundamental_present,
        sentiment_present=sentiment_present,
        macro_present=macro_present,
    )
