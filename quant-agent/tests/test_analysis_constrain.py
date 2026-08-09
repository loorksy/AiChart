"""Hand-verified coverage for the post-LLM constraint, veto and plan geometry.

Prices are all worked against a current price of 100.0 so the +-10% band is
literally [90, 110] and the 0.95/1.05 defaults are literally 95 and 105.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.engine.analysis.constrain import (
    AppliedAdjustments,
    adjust_position_size,
    finalize_trading_plan_for_decision,
    safe_float_price,
    validate_and_constrain,
)
from app.engine.analysis.models import (
    IndicatorMacd,
    IndicatorMovingAverages,
    IndicatorRsi,
    TimeframeIndicators,
)

CURRENT_PRICE = 100.0


def make_indicators(
    *,
    rsi: float | None = None,
    macd: str | None = None,
    ma_trend: str | None = None,
    **rest: Any,
) -> TimeframeIndicators:
    return TimeframeIndicators(
        rsi=IndicatorRsi(value=rsi) if rsi is not None else None,
        macd=IndicatorMacd(signal=macd) if macd is not None else None,
        moving_averages=IndicatorMovingAverages(trend=ma_trend) if ma_trend is not None else None,
        **rest,
    )


def llm_output(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "decision": "BUY",
        "confidence": 80,
        "summary": "an executive summary",
        "entry_price": CURRENT_PRICE,
        "stop_loss": 96.0,
        "take_profit": 104.0,
        "position_size_pct": 10,
        "technical_score": 50,
        "fundamental_score": 50,
        "sentiment_score": 50,
    }
    payload.update(overrides)
    return payload


def constrain(
    analysis: dict[str, Any],
    *,
    indicators: TimeframeIndicators | None = None,
    current_price: float = CURRENT_PRICE,
    has_major_news: bool = False,
    has_macro_event: bool = False,
) -> tuple[dict[str, Any], AppliedAdjustments]:
    applied = AppliedAdjustments()
    result = validate_and_constrain(
        analysis,
        current_price,
        indicators,
        has_major_news=has_major_news,
        has_macro_event=has_macro_event,
        applied=applied,
    )
    return result, applied


# --------------------------------------------------------------------------
# safe_float_price
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, 7.0),
        (1234.5, 1234.5),
        (12, 12.0),
        ("1,234.5", 1234.5),
        ("  42 ", 42.0),
        ("", 7.0),
        ("not a price", 7.0),
        (float("nan"), 7.0),
    ],
)
def test_safe_float_price(value: Any, expected: float) -> None:
    assert safe_float_price(value, 7.0) == expected


def test_safe_float_price_defaults_to_none() -> None:
    assert safe_float_price(None) is None


# --------------------------------------------------------------------------
# The +-10% entry clamp
# --------------------------------------------------------------------------


@pytest.mark.parametrize("entry", [110.000001, 111.0, 89.999999, 0.0, 1000.0])
def test_entry_outside_the_ten_percent_band_snaps_to_the_current_price(entry: float) -> None:
    analysis, applied = constrain(llm_output(entry_price=entry))
    assert analysis["entry_price"] == 100.0
    assert applied.entry_clamped is True


@pytest.mark.parametrize("entry", [90.0, 100.0, 110.0, 104.5])
def test_entry_on_or_inside_the_band_is_kept(entry: float) -> None:
    analysis, applied = constrain(llm_output(entry_price=entry))
    assert analysis["entry_price"] == entry
    assert applied.entry_clamped is False


def test_missing_entry_falls_back_to_the_current_price_without_counting_as_clamped() -> None:
    analysis, applied = constrain(llm_output(entry_price=None))
    assert analysis["entry_price"] == 100.0
    assert applied.entry_clamped is False


# --------------------------------------------------------------------------
# Direction defaults
# --------------------------------------------------------------------------


@pytest.mark.parametrize("stop", [99.0, 100.0, 111.0])
def test_sell_stop_that_is_not_above_price_or_is_out_of_band_defaults_to_1_05(
    stop: float,
) -> None:
    analysis, applied = constrain(llm_output(decision="SELL", stop_loss=stop, take_profit=96.0))
    assert analysis["stop_loss"] == 105.0
    assert applied.stop_defaulted is True


@pytest.mark.parametrize("target", [101.0, 100.0, 89.0])
def test_sell_target_that_is_not_below_price_or_is_out_of_band_defaults_to_0_95(
    target: float,
) -> None:
    analysis, applied = constrain(
        llm_output(decision="SELL", stop_loss=104.0, take_profit=target)
    )
    assert analysis["take_profit"] == 95.0
    assert applied.take_profit_defaulted is True


@pytest.mark.parametrize("stop", [101.0, 100.0, 89.0])
def test_buy_stop_that_is_not_below_price_or_is_out_of_band_defaults_to_0_95(
    stop: float,
) -> None:
    analysis, applied = constrain(llm_output(decision="BUY", stop_loss=stop))
    assert analysis["stop_loss"] == 95.0
    assert applied.stop_defaulted is True


@pytest.mark.parametrize("target", [99.0, 100.0, 111.0])
def test_buy_target_that_is_not_above_price_or_is_out_of_band_defaults_to_1_05(
    target: float,
) -> None:
    analysis, applied = constrain(llm_output(decision="BUY", take_profit=target))
    assert analysis["take_profit"] == 105.0
    assert applied.take_profit_defaulted is True


def test_usable_levels_are_kept_untouched() -> None:
    analysis, applied = constrain(llm_output(stop_loss=96.0, take_profit=104.0))
    assert (analysis["stop_loss"], analysis["take_profit"]) == (96.0, 104.0)
    assert applied.stop_defaulted is False
    assert applied.take_profit_defaulted is False


def test_prices_are_rounded_to_six_decimal_places() -> None:
    price = 1.2345678901
    analysis, _ = constrain(
        llm_output(entry_price=1.23456789, stop_loss=1.1999999996, take_profit=1.2900000004),
        current_price=price,
    )
    assert analysis["entry_price"] == 1.234568
    assert analysis["stop_loss"] == 1.2
    assert analysis["take_profit"] == 1.29


def test_a_zero_or_negative_current_price_leaves_the_analysis_alone() -> None:
    original = llm_output(entry_price=999.0)
    analysis, applied = constrain(dict(original), current_price=0.0)
    assert analysis == original
    assert applied.entry_clamped is False


# --------------------------------------------------------------------------
# Decision and numeric normalisation
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("BUY", "BUY"),
        ("buy", "BUY"),
        ("Sell", "SELL"),
        ("STRONG_BUY", "HOLD"),
        ("", "HOLD"),
        (None, "HOLD"),
        (42, "HOLD"),
    ],
)
def test_unknown_decision_values_fall_back_to_hold(raw: Any, expected: str) -> None:
    analysis, _ = constrain(llm_output(decision=raw))
    assert analysis["decision"] == expected


def test_a_missing_decision_key_defaults_to_hold() -> None:
    payload = llm_output()
    del payload["decision"]
    analysis, _ = constrain(payload)
    assert analysis["decision"] == "HOLD"


@pytest.mark.parametrize(
    ("raw", "expected"), [(150, 100), (-10, 0), ("80", 80), (72.6, 72), (None, 50)]
)
def test_confidence_is_coerced_and_clamped(raw: Any, expected: int) -> None:
    analysis, _ = constrain(llm_output(confidence=raw))
    assert analysis["confidence"] == expected


def test_the_three_model_scores_are_clamped_to_zero_hundred() -> None:
    analysis, _ = constrain(
        llm_output(technical_score=120, fundamental_score=-5, sentiment_score="66")
    )
    assert analysis["technical_score"] == 100
    assert analysis["fundamental_score"] == 0
    assert analysis["sentiment_score"] == 66


# --------------------------------------------------------------------------
# Indicator veto
# --------------------------------------------------------------------------


def test_low_confidence_forces_hold_and_floors_confidence_at_forty_five() -> None:
    analysis, applied = constrain(
        llm_output(decision="BUY", confidence=30),
        indicators=make_indicators(rsi=45.0, macd="neutral", ma_trend="sideways"),
    )
    assert analysis["decision"] == "HOLD"
    assert analysis["confidence"] == 45
    assert applied.decision_overridden_by == "indicators"


def test_low_confidence_on_an_already_hold_decision_changes_nothing() -> None:
    analysis, applied = constrain(
        llm_output(decision="HOLD", confidence=55),
        indicators=make_indicators(rsi=45.0, macd="neutral", ma_trend="sideways"),
    )
    assert analysis["decision"] == "HOLD"
    assert analysis["confidence"] == 55
    assert applied.decision_overridden_by is None


@pytest.mark.parametrize(
    ("indicator_kwargs", "expected_conflict"),
    [
        ({"rsi": 75.0, "macd": "neutral", "ma_trend": "sideways"}, "rsi_overbought"),
        ({"rsi": 45.0, "macd": "bearish", "ma_trend": "sideways"}, "macd_bearish"),
        ({"rsi": 55.0, "macd": "neutral", "ma_trend": "downtrend"}, "ma_downtrend"),
        ({"rsi": 45.0, "macd": "neutral", "ma_trend": "strong_downtrend"}, "ma_downtrend"),
    ],
)
def test_a_buy_that_fights_its_indicators_becomes_hold(
    indicator_kwargs: dict[str, Any], expected_conflict: str
) -> None:
    analysis, applied = constrain(
        llm_output(decision="BUY", confidence=80),
        indicators=make_indicators(**indicator_kwargs),
    )
    assert analysis["decision"] == "HOLD"
    assert analysis["confidence"] == 60  # max(80 - 20, 40)
    assert applied.decision_overridden_by == "indicators"
    assert expected_conflict in applied.indicator_conflicts


def test_a_plain_downtrend_only_conflicts_with_buy_above_rsi_fifty() -> None:
    analysis, applied = constrain(
        llm_output(decision="BUY", confidence=80),
        indicators=make_indicators(rsi=45.0, macd="neutral", ma_trend="downtrend"),
    )
    assert analysis["decision"] == "BUY"
    assert analysis["confidence"] == 80
    assert applied.indicator_conflicts == []


@pytest.mark.parametrize(("major_news", "macro_event"), [(True, False), (False, True)])
def test_a_major_event_buys_the_conflict_off_for_fifteen_confidence_points(
    major_news: bool, macro_event: bool
) -> None:
    analysis, applied = constrain(
        llm_output(decision="BUY", confidence=80),
        indicators=make_indicators(rsi=75.0, macd="neutral", ma_trend="sideways"),
        has_major_news=major_news,
        has_macro_event=macro_event,
    )
    assert analysis["decision"] == "BUY"
    assert analysis["confidence"] == 65  # max(80 - 15, 50)
    assert applied.decision_overridden_by is None
    assert applied.indicator_conflicts == ["rsi_overbought"]


def test_confidence_floors_bind_for_an_already_low_but_actionable_confidence() -> None:
    analysis, _ = constrain(
        llm_output(decision="BUY", confidence=60),
        indicators=make_indicators(rsi=75.0, macd="neutral", ma_trend="sideways"),
    )
    assert analysis["confidence"] == 40  # max(60 - 20, 40)


def test_a_sell_against_three_strong_bullish_signals_becomes_hold() -> None:
    analysis, applied = constrain(
        llm_output(decision="SELL", confidence=80, stop_loss=104.0, take_profit=96.0),
        indicators=make_indicators(rsi=25.0, macd="bullish", ma_trend="uptrend"),
    )
    assert analysis["decision"] == "HOLD"
    assert applied.indicator_conflicts == ["strong_bullish_signals"]


def test_a_sell_into_an_oversold_strong_uptrend_becomes_hold() -> None:
    analysis, applied = constrain(
        llm_output(decision="SELL", confidence=80, stop_loss=104.0, take_profit=96.0),
        indicators=make_indicators(rsi=25.0, macd="neutral", ma_trend="strong_uptrend"),
    )
    assert analysis["decision"] == "HOLD"
    assert applied.indicator_conflicts == ["very_strong_uptrend"]


def test_a_sell_with_merely_soft_indicators_survives() -> None:
    analysis, applied = constrain(
        llm_output(decision="SELL", confidence=80, stop_loss=104.0, take_profit=96.0),
        indicators=make_indicators(rsi=35.0, macd="bullish", ma_trend="uptrend"),
    )
    assert analysis["decision"] == "SELL"
    assert applied.indicator_conflicts == []


def test_an_empty_indicator_snapshot_skips_the_veto_entirely() -> None:
    analysis, applied = constrain(
        llm_output(decision="BUY", confidence=30), indicators=TimeframeIndicators()
    )
    assert analysis["decision"] == "BUY"
    assert applied.decision_overridden_by is None


# --------------------------------------------------------------------------
# Trading-plan geometry
# --------------------------------------------------------------------------


def test_sell_mirrors_the_atr_long_levels_around_the_current_price() -> None:
    """Long levels 96/108 around 100 mirror to 104/92."""
    analysis = finalize_trading_plan_for_decision(
        {"decision": "SELL", "stop_loss": 999.0, "take_profit": 0.0},
        CURRENT_PRICE,
        make_indicators(suggested_stop_loss=96.0, suggested_take_profit=108.0),
    )
    assert analysis["stop_loss"] == 104.0
    assert analysis["take_profit"] == 92.0


def test_mirrored_sell_levels_are_clamped_into_the_ten_percent_band() -> None:
    """Long levels 85/130 mirror to 115/70, which clamp to 110/90.

    The band edges are assigned straight from `current_price * 1.10` without a
    final rounding pass — upstream does the same, so 110.00000000000001 is the
    faithful value here, not 110.0.
    """
    analysis = finalize_trading_plan_for_decision(
        {"decision": "SELL", "stop_loss": 104.0, "take_profit": 96.0},
        CURRENT_PRICE,
        make_indicators(suggested_stop_loss=85.0, suggested_take_profit=130.0),
    )
    assert analysis["stop_loss"] == pytest.approx(110.0, rel=1e-12)
    assert analysis["take_profit"] == pytest.approx(90.0, rel=1e-12)


def test_buy_takes_the_atr_long_levels_directly() -> None:
    analysis = finalize_trading_plan_for_decision(
        {"decision": "BUY", "stop_loss": 99.0, "take_profit": 101.0},
        CURRENT_PRICE,
        make_indicators(suggested_stop_loss=96.0, suggested_take_profit=108.0),
    )
    assert analysis["stop_loss"] == 96.0
    assert analysis["take_profit"] == 108.0


def test_buy_atr_levels_outside_the_band_are_clamped() -> None:
    analysis = finalize_trading_plan_for_decision(
        {"decision": "BUY", "stop_loss": 99.0, "take_profit": 101.0},
        CURRENT_PRICE,
        make_indicators(suggested_stop_loss=80.0, suggested_take_profit=130.0),
    )
    assert analysis["stop_loss"] == 90.0
    assert analysis["take_profit"] == 110.0


def test_inverted_model_levels_without_atr_levels_fall_back_to_the_defaults() -> None:
    long_side = finalize_trading_plan_for_decision(
        {"decision": "BUY", "stop_loss": 105.0, "take_profit": 95.0}, CURRENT_PRICE, None
    )
    assert (long_side["stop_loss"], long_side["take_profit"]) == (95.0, 105.0)

    short_side = finalize_trading_plan_for_decision(
        {"decision": "SELL", "stop_loss": 95.0, "take_profit": 105.0}, CURRENT_PRICE, None
    )
    assert (short_side["stop_loss"], short_side["take_profit"]) == (105.0, 95.0)


def test_hold_leaves_the_plan_geometry_alone() -> None:
    original = {"decision": "HOLD", "stop_loss": 1.0, "take_profit": 2.0}
    assert finalize_trading_plan_for_decision(dict(original), CURRENT_PRICE, None) == original


def test_atr_levels_replacing_a_usable_model_stop_are_reported_as_defaulted() -> None:
    """`stop_defaulted` means "the engine substituted its own number", which
    includes swapping in the ATR-derived level over a valid model one."""
    analysis, applied = constrain(
        llm_output(decision="BUY", stop_loss=96.0, take_profit=104.0),
        indicators=make_indicators(
            rsi=45.0,
            macd="neutral",
            ma_trend="sideways",
            suggested_stop_loss=94.0,
            suggested_take_profit=106.0,
        ),
    )
    assert analysis["stop_loss"] == 94.0
    assert analysis["take_profit"] == 106.0
    assert applied.stop_defaulted is True
    assert applied.take_profit_defaulted is True


# --------------------------------------------------------------------------
# Position sizing
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("size", "agreement", "multiplier", "decision", "expected"),
    [
        (20, 1.0, 1.0, "BUY", 20),  # 20 * 1.0 * (0.6 + 0.4)
        (20, 0.0, 1.0, "BUY", 12),  # 20 * 0.6
        (20, 1.0, 0.65, "BUY", 13),  # 20 * 0.65
        (20, 1.0, 1.0, "HOLD", 5),  # 20 * 0.25
        (0, 1.0, 1.0, "BUY", 10),  # a zero size is read as the default 10
        (500, 1.0, 1.0, "BUY", 100),  # clamped up top
        (1, 0.0, 0.442, "HOLD", 1),  # 0.066 -> clamped to the floor of 1
    ],
)
def test_position_size_scales_with_quality_agreement_and_conviction(
    size: int, agreement: float, multiplier: float, decision: str, expected: int
) -> None:
    analysis = adjust_position_size(
        {"decision": decision, "position_size_pct": size},
        agreement=agreement,
        multiplier=multiplier,
    )
    assert analysis["position_size_pct"] == expected
