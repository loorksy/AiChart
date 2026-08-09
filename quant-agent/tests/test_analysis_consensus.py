"""Hand-verified coverage for the multi-timeframe consensus and the trend
outlook. Expected values are written as the spec's own arithmetic so a
regression cannot be re-derived from the code under test."""

from __future__ import annotations

from typing import Any

import pytest

from app.engine.analysis.consensus import (
    build_consensus,
    build_data_quality,
    consensus_confidence,
    consensus_timeframes,
    minimum_override_abs,
    multiplier_from_data_quality,
    quality_multiplier,
    score_to_decision,
    timeframe_weight,
)
from app.engine.analysis.models import (
    CollectionMeta,
    DataQuality,
    IndicatorMacd,
    IndicatorMovingAverages,
    IndicatorRsi,
    TimeframeIndicators,
)
from app.engine.analysis.outlook import build_trend_outlook, trend_strength
from app.engine.analysis.scoring import ObjectiveScore, RiskContext


def approx(value: float) -> Any:
    return pytest.approx(value, rel=1e-12, abs=1e-12)


def risk_context(
    *,
    panic: bool = False,
    bearish: bool = False,
    change_24h: float = 0.0,
) -> RiskContext:
    return RiskContext(
        trend="downtrend" if bearish else "sideways",
        macd_signal="neutral",
        rsi=50.0,
        change_24h=change_24h,
        volume_ratio=1.0,
        downtrend=bearish,
        strong_downtrend=False,
        bearish_context=bearish,
        panic_breakdown=panic,
    )


def objective(**flags: bool) -> ObjectiveScore:
    return ObjectiveScore(
        technical_score=0.0,
        fundamental_score=50.0,
        sentiment_score=0.0,
        macro_score=0.0,
        overall_score=0.0,
        crypto_factor_score=0.0,
        technical_present=flags.get("technical", True),
        fundamental_present=flags.get("fundamental", False),
        sentiment_present=flags.get("sentiment", False),
        macro_present=flags.get("macro", False),
    )


# --------------------------------------------------------------------------
# Decision thresholds
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (20.0, "BUY"),  # the threshold itself is inclusive
        (19.999, "HOLD"),
        (0.0, "HOLD"),
        (-19.999, "HOLD"),
        (-20.0, "SELL"),
        (-90.0, "SELL"),
    ],
)
def test_score_to_decision_band_edges(score: float, expected: str) -> None:
    assert score_to_decision(score) == expected


# --------------------------------------------------------------------------
# Timeframe expansion
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("primary", "expected"),
    [
        ("1H", ["1H", "4H", "1D"]),
        ("1HOUR", ["1HOUR", "4H", "1D"]),
        ("60M", ["60M", "4H", "1D"]),
        ("4H", ["4H", "1D"]),
        ("1D", ["1D", "4H"]),
        ("1DAY", ["1DAY", "4H"]),
        ("D", ["D", "4H"]),
        ("15M", ["15M", "1D", "4H"]),
        ("1W", ["1W", "1D", "4H"]),
    ],
)
def test_consensus_timeframe_expansion(primary: str, expected: list[str]) -> None:
    assert consensus_timeframes(primary) == expected


def test_consensus_timeframe_expansion_normalises_case_and_whitespace() -> None:
    assert consensus_timeframes(" 1h ") == ["1H", "4H", "1D"]


def test_consensus_timeframe_expansion_never_duplicates_the_primary() -> None:
    """A primary that the fallback branch would add again keeps one slot."""
    assert consensus_timeframes("4H") == ["4H", "1D"]
    assert consensus_timeframes("1D").count("1D") == 1


# --------------------------------------------------------------------------
# Weights
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("timeframe", "base"),
    [("1M", 0.75), ("3M", 0.75), ("5M", 0.80), ("15M", 0.85), ("30M", 0.90),
     ("1H", 0.95), ("4H", 1.10), ("1D", 1.30), ("1W", 1.35)],
)
def test_timeframe_base_weights(timeframe: str, base: float) -> None:
    assert timeframe_weight(timeframe, 0.0) == approx(base)


def test_timeframe_weight_scales_with_reading_strength_and_saturates_at_double() -> None:
    assert timeframe_weight("1D", 50.0) == approx(1.30 * 1.5)
    assert timeframe_weight("1D", 100.0) == approx(1.30 * 2.0)
    # min(1, abs/100): a stronger reading cannot buy more than a doubling.
    assert timeframe_weight("1D", 400.0) == approx(1.30 * 2.0)


def test_unknown_timeframe_falls_back_to_weight_one() -> None:
    assert timeframe_weight("7X", 0.0) == approx(1.0)


# --------------------------------------------------------------------------
# Consensus aggregation
# --------------------------------------------------------------------------


def test_consensus_is_the_strength_weighted_mean_over_the_consensus_frames() -> None:
    """Primary 1H -> frames 1H, 4H, 1D.
      1H: 0.95 * 1.10 = 1.045   x  10.0
      4H: 1.10 * 1.20 = 1.32    x -20.0
      1D: 1.30 * 1.40 = 1.82    x  40.0
      (10.45 - 26.4 + 72.8) / (1.045 + 1.32 + 1.82) = 56.85 / 4.185
    """
    outcome = build_consensus(
        primary_timeframe="1H",
        overall_by_timeframe={"1H": 10.0, "4H": -20.0, "1D": 40.0},
    )
    assert outcome.consensus.score == approx(56.85 / 4.185)
    assert outcome.consensus.weighted_score == approx(outcome.consensus.score)
    assert outcome.consensus.decision == "HOLD"
    assert outcome.consensus.votes == {"BUY": 1, "SELL": 1, "HOLD": 1}
    assert outcome.consensus.timeframe_count == 3
    assert outcome.consensus.agreement == approx(1 / 3)
    assert outcome.ordered_timeframes == ["1H", "4H", "1D"]


def test_outlook_only_frames_dilute_agreement_without_moving_the_score() -> None:
    """Primary 1D weighs only 1D and 4H; the 1W and 1H frames are reported
    and counted toward agreement, exactly as upstream's extra horizons are.
      1D: 1.30 * 1.30 = 1.69   x 30.0
      4H: 1.10 * 1.25 = 1.375  x 25.0
      (50.7 + 34.375) / 3.065
    """
    scores = {"1D": 30.0, "4H": 25.0, "1W": -50.0, "1H": 5.0}
    outcome = build_consensus(primary_timeframe="1D", overall_by_timeframe=scores)

    assert outcome.consensus.score == approx(85.075 / 3.065)
    assert outcome.consensus.decision == "BUY"
    # Votes come only from the weighted frames.
    assert outcome.consensus.votes == {"BUY": 2, "SELL": 0, "HOLD": 0}
    # Agreement is measured across every frame that was scored.
    assert outcome.consensus.timeframe_count == 4
    assert outcome.consensus.agreement == approx(0.5)
    assert outcome.ordered_timeframes == ["1D", "4H", "1W", "1H"]


def test_consensus_ignores_an_expansion_frame_the_caller_did_not_send() -> None:
    """A frame `web/` never collected is absent, never substituted."""
    outcome = build_consensus(primary_timeframe="1D", overall_by_timeframe={"1D": 30.0})
    assert outcome.ordered_timeframes == ["1D"]
    assert outcome.consensus.score == approx(30.0)
    assert outcome.consensus.timeframe_count == 1
    assert outcome.consensus.agreement == approx(1.0)


def test_consensus_with_no_weighted_frame_scores_zero() -> None:
    outcome = build_consensus(primary_timeframe="1D", overall_by_timeframe={"5M": 80.0})
    assert outcome.consensus.score == approx(0.0)
    assert outcome.consensus.decision == "HOLD"
    assert outcome.consensus.votes == {"BUY": 0, "SELL": 0, "HOLD": 0}
    # The frame is still reported, and still counted for agreement.
    assert outcome.ordered_timeframes == ["5M"]
    assert outcome.consensus.agreement == approx(0.0)


# --------------------------------------------------------------------------
# Consensus confidence and the override floor
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("consensus_abs", "agreement", "multiplier", "expected"),
    [
        # 50 + 30*0.35 = 60.5 -> 60 ; 60 * 1.15 = 69.0 -> 69 ; * 1.0 -> 69
        (30.0, 1.0, 1.0, 69),
        # 50 + 70 = 120 -> capped 98 ; 98 * 0.85 = 83.3 -> 83
        (200.0, 0.0, 1.0, 83),
        # 50 -> floor 40 does not bind ; 50 * 0.85 = 42.5 -> 42
        (0.0, 0.0, 1.0, 42),
        # ...and data quality scales the result last.
        (0.0, 0.0, 0.5, 21),
    ],
)
def test_consensus_confidence_ladder(
    consensus_abs: float, agreement: float, multiplier: float, expected: int
) -> None:
    assert (
        consensus_confidence(
            consensus_abs=consensus_abs, agreement=agreement, multiplier=multiplier
        )
        == expected
    )


def test_minimum_override_defaults_to_fifteen_in_a_trending_market() -> None:
    assert minimum_override_abs(
        consensus_decision="SELL",
        llm_decision="BUY",
        regime="trending",
        risk=risk_context(),
    ) == approx(15.0)


def test_minimum_override_is_raised_twenty_percent_in_a_ranging_market() -> None:
    assert minimum_override_abs(
        consensus_decision="SELL",
        llm_decision="BUY",
        regime="ranging",
        risk=risk_context(),
    ) == approx(15.0 * 1.2)


def test_minimum_override_for_buying_into_a_bearish_tape_is_forty() -> None:
    assert minimum_override_abs(
        consensus_decision="BUY",
        llm_decision="SELL",
        regime="trending",
        risk=risk_context(bearish=True),
    ) == approx(40.0)


def test_minimum_override_for_buying_into_a_breakdown_is_fifty_five() -> None:
    assert minimum_override_abs(
        consensus_decision="BUY",
        llm_decision="HOLD",
        regime="trending",
        risk=risk_context(panic=True, bearish=True),
    ) == approx(55.0)


def test_minimum_override_floor_does_not_apply_when_the_model_agrees() -> None:
    """The floor exists to stop the rule layer forcing a BUY the model did not
    want; a model that already said BUY needs no such protection."""
    assert minimum_override_abs(
        consensus_decision="BUY",
        llm_decision="BUY",
        regime="trending",
        risk=risk_context(panic=True, bearish=True),
    ) == approx(15.0)


# --------------------------------------------------------------------------
# Data quality
# --------------------------------------------------------------------------


def _complete_indicators() -> TimeframeIndicators:
    return TimeframeIndicators(
        rsi=IndicatorRsi(value=50.0),
        macd=IndicatorMacd(signal="neutral"),
        moving_averages=IndicatorMovingAverages(trend="sideways"),
    )


@pytest.mark.parametrize(
    ("degraded", "expected"),
    [([], 1.0), (["macro"], 0.85), (["news"], 0.8), (["macro", "news"], 0.85 * 0.8)],
)
def test_quality_multiplier_from_degraded_inputs(
    degraded: list[str], expected: float
) -> None:
    multiplier = quality_multiplier(
        primary_meta=CollectionMeta(degraded_inputs=degraded),
        primary_indicators=_complete_indicators(),
    )
    assert multiplier == approx(expected)


@pytest.mark.parametrize(
    "broken",
    [
        # No RSI object at all...
        TimeframeIndicators(moving_averages=IndicatorMovingAverages(trend="sideways")),
        # ...an RSI object with nothing in it (upstream's falsy empty dict)...
        TimeframeIndicators(
            rsi=IndicatorRsi(),
            moving_averages=IndicatorMovingAverages(trend="sideways"),
        ),
        # ...or a missing moving-average trend.
        TimeframeIndicators(rsi=IndicatorRsi(value=50.0)),
    ],
)
def test_quality_multiplier_penalises_a_missing_indicator_section(
    broken: TimeframeIndicators,
) -> None:
    assert quality_multiplier(
        primary_meta=CollectionMeta(), primary_indicators=broken
    ) == approx(0.65)


def test_quality_multiplier_compounds_every_gap() -> None:
    assert quality_multiplier(
        primary_meta=CollectionMeta(degraded_inputs=["macro", "news"]),
        primary_indicators=TimeframeIndicators(),
    ) == approx(0.85 * 0.8 * 0.65)


def test_data_quality_names_the_absent_components_and_the_degraded_inputs() -> None:
    quality = build_data_quality(
        multiplier=0.85,
        primary_meta=CollectionMeta(ok=True, degraded_inputs=["macro"]),
        primary_objective=objective(technical=True),
    )
    assert quality.degraded is True
    assert quality.confidence_penalty == 15
    assert quality.missing == ["fundamental", "sentiment", "macro"]


def test_data_quality_is_clean_when_everything_was_collected() -> None:
    quality = build_data_quality(
        multiplier=1.0,
        primary_meta=CollectionMeta(),
        primary_objective=objective(
            technical=True, fundamental=True, sentiment=True, macro=True
        ),
    )
    assert quality.degraded is False
    assert quality.confidence_penalty == 0
    assert quality.missing == []


def test_data_quality_flags_a_failed_collection_even_at_full_multiplier() -> None:
    quality = build_data_quality(
        multiplier=1.0,
        primary_meta=CollectionMeta(ok=False),
        primary_objective=objective(
            technical=True, fundamental=True, sentiment=True, macro=True
        ),
    )
    assert quality.degraded is True


def test_multiplier_round_trips_through_the_reported_penalty() -> None:
    assert multiplier_from_data_quality(None) == approx(1.0)
    quality = DataQuality(degraded=True, confidence_penalty=35, missing=[])
    assert multiplier_from_data_quality(quality) == approx(0.65)


# --------------------------------------------------------------------------
# Trend outlook
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("score", "expected"),
    [(70.0, "strong"), (69.9, "moderate"), (40.0, "moderate"), (39.9, "mild"),
     (20.0, "mild"), (19.9, "neutral"), (-70.0, "strong"), (-20.0, "mild")],
)
def test_trend_strength_bands(score: float, expected: str) -> None:
    assert trend_strength(score) == expected


def test_trend_outlook_legs_are_built_from_the_frames_that_exist() -> None:
    """1D 20, 4H 10, 1H -30, 1W 40; fundamental 50, macro 0.
      h24 = 1H                                    = -30.0  -> bearish / mild
      d3  = 1D*0.7 + 4H*0.3 = 14 + 3              =  17.0  -> neutral / neutral
      w1  = 1W                                    =  40.0  -> bullish / moderate
      m1  = 1W*0.55 + 50*0.30 + 0*0.15 = 22 + 15  =  37.0  -> bullish / mild
    """
    outlook = build_trend_outlook(
        overall_by_timeframe={"1D": 20.0, "4H": 10.0, "1H": -30.0, "1W": 40.0},
        primary_overall=20.0,
        primary_fundamental_score=50.0,
        primary_macro_score=0.0,
        risk=risk_context(),
    )
    assert (outlook.h24.score, outlook.h24.label, outlook.h24.qualifier) == (
        -30.0, "bearish", "mild",
    )
    assert (outlook.d3.score, outlook.d3.label, outlook.d3.qualifier) == (
        17.0, "neutral", "neutral",
    )
    assert (outlook.w1.score, outlook.w1.label, outlook.w1.qualifier) == (
        40.0, "bullish", "moderate",
    )
    assert (outlook.m1.score, outlook.m1.label, outlook.m1.qualifier) == (
        37.0, "bullish", "mild",
    )


def test_trend_outlook_inherits_along_the_fallback_chain() -> None:
    """Only a 5M frame exists: 1D falls back to the primary score, and 4H/1H/1W
    all inherit from 1D. m1 = 12*0.55 + 50*0.30 = 21.6."""
    outlook = build_trend_outlook(
        overall_by_timeframe={"5M": 12.0},
        primary_overall=12.0,
        primary_fundamental_score=50.0,
        primary_macro_score=0.0,
        risk=risk_context(),
    )
    assert outlook.h24.score == approx(12.0)
    assert outlook.d3.score == approx(12.0)
    assert outlook.w1.score == approx(12.0)
    assert outlook.m1.score == approx(21.6)


def test_trend_outlook_treats_an_exactly_zero_frame_as_missing() -> None:
    """Upstream spells the 4H fallback with `or`, so a 0.0 reading inherits
    from 1D instead of pulling the 3-day leg down. Reproduced deliberately.
    d3 would be 25*0.7 + 0*0.3 = 17.5 without the quirk; it is 25.0 with it.
    """
    outlook = build_trend_outlook(
        overall_by_timeframe={"1D": 25.0, "4H": 0.0},
        primary_overall=25.0,
        primary_fundamental_score=50.0,
        primary_macro_score=0.0,
        risk=risk_context(),
    )
    assert outlook.d3.score == approx(25.0)


def test_trend_outlook_panic_caps_every_horizon() -> None:
    outlook = build_trend_outlook(
        overall_by_timeframe={"1D": 80.0, "4H": 80.0, "1H": 80.0, "1W": 80.0},
        primary_overall=80.0,
        primary_fundamental_score=50.0,
        primary_macro_score=0.0,
        risk=risk_context(panic=True, bearish=True, change_24h=-9.0),
    )
    assert outlook.h24.score == approx(-20.0)
    assert outlook.d3.score == approx(-10.0)
    assert outlook.w1.score == approx(0.0)
    # m1 would be 80*0.55 + 15 = 59.0, capped to 10.0.
    assert outlook.m1.score == approx(10.0)


def test_trend_outlook_bearish_caps_only_the_two_near_horizons() -> None:
    scores = {"1D": 80.0, "4H": 80.0, "1H": 80.0, "1W": 80.0}
    capped = build_trend_outlook(
        overall_by_timeframe=scores,
        primary_overall=80.0,
        primary_fundamental_score=50.0,
        primary_macro_score=0.0,
        risk=risk_context(bearish=True, change_24h=-3.0),
    )
    assert capped.h24.score == approx(5.0)
    assert capped.d3.score == approx(10.0)
    assert capped.w1.score == approx(80.0)
    assert capped.m1.score == approx(59.0)

    # One hundredth of a percent shallower and no cap applies.
    uncapped = build_trend_outlook(
        overall_by_timeframe=scores,
        primary_overall=80.0,
        primary_fundamental_score=50.0,
        primary_macro_score=0.0,
        risk=risk_context(bearish=True, change_24h=-2.99),
    )
    assert uncapped.h24.score == approx(80.0)
    assert uncapped.d3.score == approx(80.0)


def test_trend_outlook_scores_are_rounded_to_two_decimals() -> None:
    outlook = build_trend_outlook(
        overall_by_timeframe={"1D": 1.23456, "4H": 7.65432},
        primary_overall=1.23456,
        primary_fundamental_score=50.0,
        primary_macro_score=0.0,
        risk=risk_context(),
    )
    assert outlook.d3.score == approx(round(1.23456 * 0.7 + 7.65432 * 0.3, 2))
    assert outlook.d3.score == 3.16
