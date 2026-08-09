"""Hand-verified coverage for the objective scoring port.

Every expected value below is written as the arithmetic the specification
quotes — `-50 * 0.30 / 1.15`, not a copied-out decimal — so a regression in
the implementation cannot be papered over by re-deriving the number from the
code under test.

The recurring `1.15` is the full component weight sum: RSI 0.30 + MACD 0.25 +
MA trend 0.25 + 24h change 0.20 + the "extra" bucket's fixed 0.15.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.engine.analysis.models import (
    IndicatorBollinger,
    IndicatorMacd,
    IndicatorMovingAverages,
    IndicatorRsi,
    TimeframeIndicators,
)
from app.engine.analysis.scoring import (
    calculate_crypto_factor_score,
    calculate_fundamental_score,
    calculate_macro_score,
    calculate_objective_score,
    calculate_sentiment_score,
    calculate_technical_score,
    detect_market_regime,
    technical_risk_context,
)

FULL_WEIGHT_SUM = 1.15


def make_indicators(
    *,
    rsi: float | None = None,
    macd: str | None = None,
    ma_trend: str | None = None,
    bollinger: tuple[float, float] | None = None,
    **rest: Any,
) -> TimeframeIndicators:
    return TimeframeIndicators(
        rsi=IndicatorRsi(value=rsi) if rsi is not None else None,
        macd=IndicatorMacd(signal=macd) if macd is not None else None,
        moving_averages=IndicatorMovingAverages(trend=ma_trend) if ma_trend is not None else None,
        bollinger=(
            IndicatorBollinger(upper=bollinger[0], lower=bollinger[1])
            if bollinger is not None
            else None
        ),
        **rest,
    )


def approx(value: float) -> Any:
    return pytest.approx(value, rel=1e-12, abs=1e-12)


# --------------------------------------------------------------------------
# RSI bands
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("rsi_value", "expected_rsi_component"),
    [
        (75.0, -50.0),  # > 70
        (70.0, -30.0),  # exactly 70 is NOT "> 70"
        (65.0, -30.0),  # > 60
        (60.0, (50 - 60) * 0.6),  # exactly 60 falls through to the linear band
        (50.0, 0.0),
        (45.0, (50 - 45) * 0.6),
        (40.0, (50 - 40) * 0.6),  # exactly 40 is NOT "< 40"
        (39.0, 30.0),  # < 40
        (30.0, 30.0),  # exactly 30 is NOT "< 30", but it IS "< 40"
        (29.0, 50.0),  # < 30
    ],
)
def test_technical_rsi_bands_and_their_boundaries(
    rsi_value: float, expected_rsi_component: float
) -> None:
    """With MACD/MA/change neutral, the score is the RSI band alone:
    `rsi_score * 0.30 / 1.15`."""
    score = calculate_technical_score(make_indicators(rsi=rsi_value))
    assert score == approx(expected_rsi_component * 0.30 / FULL_WEIGHT_SUM)


def test_technical_rsi_of_zero_is_skipped_entirely() -> None:
    """`if rsi_value > 0` gates the whole component: a reported 0 means "no
    reading", so RSI contributes neither score nor weight."""
    score = calculate_technical_score(make_indicators(rsi=0.0, macd="bullish"))
    # weight_sum is 0.85 (no RSI), but the divisor is max(1.0, 0.85) = 1.0.
    assert score == approx(40.0 * 0.25 / 1.0)
    assert score == approx(10.0)


def test_technical_missing_rsi_still_carries_its_weight_at_neutral_fifty() -> None:
    """Upstream's `rsi_data.get("value", 50)`: absent RSI scores 0 but still
    adds 0.30 to the weight sum, which damps everything else."""
    score = calculate_technical_score(make_indicators(macd="bullish"))
    assert score == approx(40.0 * 0.25 / FULL_WEIGHT_SUM)


# --------------------------------------------------------------------------
# RSI bearish-context caps
# --------------------------------------------------------------------------


def test_technical_oversold_rsi_is_capped_at_eight_in_a_bearish_context() -> None:
    """RSI 25 would score +50; a bearish MACD caps it at 8.

    score = 8*0.30 + (-40)*0.25 = 2.4 - 10.0 = -7.6, over 1.15.
    """
    score = calculate_technical_score(make_indicators(rsi=25.0, macd="bearish"))
    assert score == approx((8.0 * 0.30 + -40.0 * 0.25) / FULL_WEIGHT_SUM)


def test_technical_mildly_oversold_rsi_is_capped_at_six_in_a_bearish_context() -> None:
    """RSI 35 would score +30; the `rsi < 40 and bearish_context` cap is 6."""
    score = calculate_technical_score(make_indicators(rsi=35.0, macd="bearish"))
    assert score == approx((6.0 * 0.30 + -40.0 * 0.25) / FULL_WEIGHT_SUM)


def test_technical_mildly_oversold_rsi_is_uncapped_without_a_bearish_context() -> None:
    score = calculate_technical_score(make_indicators(rsi=35.0, macd="neutral"))
    assert score == approx(30.0 * 0.30 / FULL_WEIGHT_SUM)


def test_technical_oversold_rsi_scores_minus_ten_inside_a_panic_breakdown() -> None:
    """Panic overrides the bearish cap: +50 becomes -10, and the -25.0 floor
    then binds on the total."""
    indicators = make_indicators(
        rsi=25.0, macd="bearish", ma_trend="strong_downtrend", change_24h=-4.0
    )
    assert calculate_technical_score(indicators) == approx(-25.0)


# --------------------------------------------------------------------------
# panic_breakdown — the three-way OR
# --------------------------------------------------------------------------


def test_risk_panic_first_arm_strong_downtrend_bearish_macd_three_percent_drop() -> None:
    fires = make_indicators(rsi=50.0, macd="bearish", ma_trend="strong_downtrend", change_24h=-3.0)
    misses = make_indicators(
        rsi=50.0, macd="bearish", ma_trend="strong_downtrend", change_24h=-2.99
    )
    assert technical_risk_context(fires).panic_breakdown is True
    assert technical_risk_context(misses).panic_breakdown is False


def test_risk_panic_second_arm_plain_downtrend_needs_a_five_percent_drop() -> None:
    fires = make_indicators(rsi=50.0, macd="bearish", ma_trend="downtrend", change_24h=-5.0)
    misses = make_indicators(rsi=50.0, macd="bearish", ma_trend="downtrend", change_24h=-4.99)
    assert technical_risk_context(fires).panic_breakdown is True
    assert technical_risk_context(misses).panic_breakdown is False
    # The second arm did not fire, but the tape is still bearish.
    assert technical_risk_context(misses).bearish_context is True


def test_risk_panic_third_arm_is_capitulation_volume_with_no_trend_context() -> None:
    """An 8% drop on 1.3x volume is a breakdown whatever the MA and MACD say."""
    fires = make_indicators(rsi=50.0, macd="neutral", ma_trend="uptrend",
                            change_24h=-8.0, volume_ratio=1.3)
    quiet = make_indicators(rsi=50.0, macd="neutral", ma_trend="uptrend",
                            change_24h=-8.0, volume_ratio=1.29)
    shallow = make_indicators(rsi=50.0, macd="neutral", ma_trend="uptrend",
                              change_24h=-7.99, volume_ratio=2.0)
    assert technical_risk_context(fires).panic_breakdown is True
    assert technical_risk_context(quiet).panic_breakdown is False
    assert technical_risk_context(shallow).panic_breakdown is False
    # ...and this arm alone does not make the context bearish.
    assert technical_risk_context(fires).bearish_context is False


def test_risk_bearish_context_is_downtrend_or_bearish_macd() -> None:
    assert technical_risk_context(make_indicators(ma_trend="downtrend")).bearish_context is True
    assert technical_risk_context(make_indicators(macd="bearish")).bearish_context is True
    assert technical_risk_context(make_indicators(ma_trend="uptrend")).bearish_context is False


def test_risk_context_reads_moving_average_trend_ahead_of_the_flat_trend_field() -> None:
    indicators = make_indicators(ma_trend="downtrend", trend="uptrend")
    assert technical_risk_context(indicators).trend == "downtrend"


# --------------------------------------------------------------------------
# The "extra" bucket
# --------------------------------------------------------------------------


def test_technical_extra_bucket_always_contributes_exactly_zero_point_fifteen() -> None:
    """`extra_weight` is only a boolean gate; the weight that reaches the
    weight sum is the fixed 0.15 whether the bucket collected 0.20 or 0.35.

    Both cases carry the same bucket VALUE (price position 0 -> 15 + 5 = 20)
    but different accumulated `extra_weight`, and must score identically.
    """
    only_price_position = calculate_technical_score(make_indicators(price_position=0.0))
    plus_neutral_bollinger_and_volume = calculate_technical_score(
        make_indicators(
            price_position=0.0,
            current_price=100.0,
            bollinger=(110.0, 90.0),  # dead centre -> (0.5 - 0.5) * 10 = 0
            volume_ratio=0.5,  # <= 0.6 -> adds 0 to the bucket
        )
    )
    assert only_price_position == approx(20.0 * 0.15 / FULL_WEIGHT_SUM)
    assert plus_neutral_bollinger_and_volume == approx(only_price_position)


def test_technical_price_position_caps_under_bearish_and_panic_contexts() -> None:
    """A washed-out price position (<= 20) is capped at 3 in a bearish tape
    and pushed to -3 in a panic."""
    bearish = calculate_technical_score(
        make_indicators(rsi=50.0, macd="bearish", price_position=0.0)
    )
    # bucket 20 -> capped to 3
    assert bearish == approx((-40.0 * 0.25 + 3.0 * 0.15) / FULL_WEIGHT_SUM)

    panic = calculate_technical_score(
        make_indicators(
            rsi=50.0,
            macd="bearish",
            ma_trend="strong_downtrend",
            change_24h=-3.0,
            price_position=0.0,
        )
    )
    # The panic floor binds on the total regardless of the bucket.
    assert panic == approx(-25.0)


def test_technical_bollinger_touch_is_penalised_but_only_outside_a_bearish_tape() -> None:
    at_lower_band_calm = calculate_technical_score(
        make_indicators(rsi=50.0, current_price=90.0, bollinger=(110.0, 90.0))
    )
    assert at_lower_band_calm == approx(12.0 * 0.15 / FULL_WEIGHT_SUM)

    at_upper_band = calculate_technical_score(
        make_indicators(rsi=50.0, current_price=110.0, bollinger=(110.0, 90.0))
    )
    assert at_upper_band == approx(-12.0 * 0.15 / FULL_WEIGHT_SUM)


def test_technical_volume_branch_reads_the_flat_trend_field_first() -> None:
    """The volume branch's read order is the reverse of the risk context's:
    `indicators.trend` wins over `moving_averages.trend` here."""
    indicators = make_indicators(
        rsi=50.0, ma_trend="sideways", trend="uptrend", volume_ratio=1.8
    )
    assert calculate_technical_score(indicators) == approx(8.0 * 0.15 / FULL_WEIGHT_SUM)


# --------------------------------------------------------------------------
# Volatility damping
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("volatility_pct", "bucket_factor", "score_factor"),
    [
        (3.49, 1.0, 1.0),  # below the first boundary: untouched
        (3.5, 0.8, 0.96),  # first boundary is inclusive
        (5.99, 0.8, 0.96),
        (6.0, 0.6, 0.92),  # second boundary is inclusive
        (12.0, 0.6, 0.92),
    ],
)
def test_technical_volatility_damping_boundaries(
    volatility_pct: float, bucket_factor: float, score_factor: float
) -> None:
    """Base case: RSI 70 (-30), MACD bullish (+40), price position 0 (bucket
    20). Running score before damping = -9.0 + 10.0 = 1.0.
    """
    score = calculate_technical_score(
        make_indicators(
            rsi=70.0, macd="bullish", price_position=0.0, volatility_pct=volatility_pct
        )
    )
    running = (-30.0 * 0.30 + 40.0 * 0.25) * score_factor
    expected = (running + 20.0 * bucket_factor * 0.15) / FULL_WEIGHT_SUM
    assert score == approx(expected)


# --------------------------------------------------------------------------
# Divisor, floors and clamps
# --------------------------------------------------------------------------


def test_technical_divisor_never_drops_below_one() -> None:
    """With RSI skipped the weight sum is 0.85, but `max(1.0, weight_sum)`
    keeps the divisor at 1.0 — dividing by 0.85 would AMPLIFY a partial
    component set instead of damping it."""
    score = calculate_technical_score(make_indicators(rsi=0.0, macd="bullish"))
    assert score == approx(10.0)
    assert score != approx(40.0 * 0.25 / 0.85)


def test_technical_panic_floor_is_a_cap_not_an_assignment() -> None:
    """`min(score, -25.0)` leaves an already-worse score alone.

    RSI 75 (-50), MACD bearish (-40), MA strong_downtrend (-40),
    24h -12% capped to -20 by the panic branch, price position 95
    ((50-95)*0.3 - 5 = -18.5):
      (-15.0 - 10.0 - 10.0 - 4.0 - 2.775) / 1.15 = -41.775 / 1.15
    """
    score = calculate_technical_score(
        make_indicators(
            rsi=75.0,
            macd="bearish",
            ma_trend="strong_downtrend",
            change_24h=-12.0,
            price_position=95.0,
        )
    )
    assert score == approx(-41.775 / FULL_WEIGHT_SUM)
    assert score < -25.0


def test_technical_bearish_floor_of_five_binds_after_a_three_percent_drop() -> None:
    """A constructive-looking reading inside a bearish tape is floored at 5.0.

    RSI 41 -> (50-41)*0.6 = 5.4 (no cap, 41 is not < 40)   ->  1.62
    MACD bullish                                            -> +10.00
    MA downtrend                                            ->  -6.25
    24h -3.0%                                               ->  -1.20
    bucket: price position 0 -> 20, capped to 3 by bearish; volume 1.8 on a
    flat trend of "uptrend" -> +8; total 11 * 0.15          -> +1.65
    sum 5.82 / 1.15 = 5.0609..., floored to 5.0
    """
    payload = dict(
        rsi=41.0,
        macd="bullish",
        ma_trend="downtrend",
        trend="uptrend",
        price_position=0.0,
        volume_ratio=1.8,
    )
    floored = calculate_technical_score(make_indicators(change_24h=-3.0, **payload))
    assert floored == approx(5.0)

    # One hundredth of a percent shallower and the floor does not apply.
    unfloored = calculate_technical_score(make_indicators(change_24h=-2.99, **payload))
    assert unfloored == approx((1.62 + 10.0 - 6.25 + -2.99 * 2 * 0.20 + 1.65) / FULL_WEIGHT_SUM)
    assert unfloored > 5.0


def test_technical_score_is_clamped_to_the_hundred_point_scale() -> None:
    extreme = make_indicators(
        rsi=25.0, macd="bullish", ma_trend="strong_uptrend", change_24h=-20.0,
        price_position=0.0,
    )
    assert -100.0 <= calculate_technical_score(extreme) <= 100.0


def test_detect_market_regime() -> None:
    assert detect_market_regime(make_indicators(ma_trend="strong_downtrend")) == "trending"
    assert detect_market_regime(make_indicators(ma_trend="uptrend")) == "trending"
    assert detect_market_regime(make_indicators(ma_trend="sideways")) == "ranging"
    assert detect_market_regime(make_indicators()) == "ranging"


# --------------------------------------------------------------------------
# Fundamental
# --------------------------------------------------------------------------


def test_fundamental_returns_neutral_fifty_outside_equity_markets() -> None:
    """Not 0.0 — a forex pair has no P/E, which is neutral, not bearish."""
    assert calculate_fundamental_score({"pe_ratio": 10}, "Forex") == 50.0
    assert calculate_fundamental_score({"pe_ratio": 10}, "Crypto") == 50.0
    assert calculate_fundamental_score(None, "USStock") == 50.0


def test_fundamental_returns_neutral_fifty_when_no_factor_scores() -> None:
    assert calculate_fundamental_score({"market_cap": 1e9}, "USStock") == 50.0


def test_fundamental_is_the_factor_mean_times_twenty_five() -> None:
    """pe 30 (0), roe 12 (0), growth 5 (0), margin 15 (+7), d/e 1.0 (0)
    over 5 factors: 7 / 5 * 100 / 4 = 35.0."""
    payload = {
        "pe_ratio": 30,
        "roe": 12,
        "revenue_growth": 5,
        "profit_margin": 15,
        "debt_to_equity": 1.0,
    }
    assert calculate_fundamental_score(payload, "USStock") == approx(35.0)


def test_fundamental_single_strong_factor_saturates_the_clamp() -> None:
    """20 / 1 * 100 / 4 = 500, clamped to 100 — upstream behaviour, kept."""
    assert calculate_fundamental_score({"pe_ratio": 10}, "USStock") == 100.0


# --------------------------------------------------------------------------
# Sentiment
# --------------------------------------------------------------------------


def test_sentiment_is_zero_without_news() -> None:
    assert calculate_sentiment_score(None) == 0.0
    assert calculate_sentiment_score([]) == 0.0


def test_sentiment_base_is_the_net_ratio_times_sixty() -> None:
    news = [{"sentiment": "positive"}, {"sentiment": "neutral"}]
    assert calculate_sentiment_score(news) == approx(30.0)


def test_sentiment_geopolitical_penalty_is_capped_in_aggregate() -> None:
    """Four severe items would be -168; the cumulative floor is -55.
    First item -42, second clipped to -13, the rest contribute nothing."""
    news = [{"sentiment": "neutral", "geopolitical_level": "severe"} for _ in range(4)]
    assert calculate_sentiment_score(news) == approx(-55.0)


def test_sentiment_moderate_geopolitical_delta_is_minus_eighteen() -> None:
    news = [{"sentiment": "neutral", "geopolitical_level": "moderate"}]
    assert calculate_sentiment_score(news) == approx(-18.0)


def test_sentiment_global_event_flag_is_promoted_to_moderate() -> None:
    news = [{"sentiment": "neutral", "is_global_event": True}]
    assert calculate_sentiment_score(news) == approx(-18.0)


def test_sentiment_only_scans_the_first_fifteen_items() -> None:
    news = [{"sentiment": "positive"} for _ in range(15)]
    news += [{"sentiment": "negative"} for _ in range(10)]
    assert calculate_sentiment_score(news) == approx(60.0)


# --------------------------------------------------------------------------
# Macro
# --------------------------------------------------------------------------


def test_macro_is_zero_without_data() -> None:
    assert calculate_macro_score(None, "Forex") == 0.0
    assert calculate_macro_score({}, "Forex") == 0.0


@pytest.mark.parametrize(
    ("vix", "raw"),
    [(40.0, -50.0), (32.0, -40.0), (27.0, -30.0), (22.0, -15.0),
     (18.0, 0.0), (13.0, 10.0), (10.0, 20.0)],
)
def test_macro_vix_bands_normalise_against_the_constant_one_two_five(
    vix: float, raw: float
) -> None:
    score = calculate_macro_score({"VIX": {"price": vix}}, "Forex")
    assert score == approx(raw / 125.0 * 100)


def test_macro_dollar_index_hits_harder_for_forex_than_for_equities() -> None:
    macro = {"DXY": {"price": 105.0, "changePercent": 1.5}}
    assert calculate_macro_score(macro, "Forex") == approx(-20.0 / 125.0 * 100)
    assert calculate_macro_score(macro, "USStock") == approx(0.0)


def test_macro_treasury_yield_only_scores_for_crypto_and_us_equities() -> None:
    macro = {"TNX": {"price": 4.5, "changePercent": 2.5}}
    assert calculate_macro_score(macro, "USStock") == approx(-20.0 / 125.0 * 100)
    # Any other market counts the factor but scores it zero.
    assert calculate_macro_score(macro, "Forex") == approx(0.0)


def test_macro_fear_and_greed_only_applies_to_crypto() -> None:
    macro = {"FEAR_GREED": {"price": 85.0}}
    assert calculate_macro_score(macro, "Crypto") == approx(-15.0 / 125.0 * 100)
    assert calculate_macro_score(macro, "Forex") == approx(0.0)


# --------------------------------------------------------------------------
# Crypto factors
# --------------------------------------------------------------------------


def test_crypto_factor_score_is_zero_and_empty_without_data() -> None:
    outcome = calculate_crypto_factor_score(None, -1.0)
    assert outcome.score == 0.0
    assert outcome.breakdown == []


def test_crypto_factor_score_is_additive_with_an_explainable_breakdown() -> None:
    outcome = calculate_crypto_factor_score(
        {
            "funding_rate": 0.02,
            "open_interest_change_24h": 5.0,  # +18
            "exchange_netflow": -1000.0,  # +16
            "stablecoin_netflow": 500.0,  # +12
            "long_short_ratio": 1.7,  # -10
            "volume_change_24h": 20.0,  # +10 with a positive change
            "signals": {"squeeze_risk": "medium"},  # -3
        },
        2.0,
    )
    assert outcome.score == approx(18 + 16 + 12 - 10 + 10 - 3)
    assert [entry["factor"] for entry in outcome.breakdown] == [
        "funding_oi",
        "exchange_netflow",
        "stablecoin_netflow",
        "long_short_ratio",
        "volume_price",
        "squeeze_risk",
    ]


# --------------------------------------------------------------------------
# Objective weighting over PRESENT components only
# --------------------------------------------------------------------------


def test_objective_with_technical_only_is_the_technical_score() -> None:
    """Forex with no news/macro/fundamentals: the weighted mean over a single
    present component is that component."""
    indicators = make_indicators(rsi=75.0)
    objective = calculate_objective_score(market="Forex", indicators=indicators)

    assert objective.technical_present is True
    assert objective.fundamental_present is False
    assert objective.sentiment_present is False
    assert objective.macro_present is False
    assert objective.overall_score == approx(objective.technical_score)
    # Reported, but not weighed: the neutral fallback, not a zero.
    assert objective.fundamental_score == 50.0


def test_objective_weights_all_four_components_when_all_are_present() -> None:
    """technical 0.0, fundamental 35.0, sentiment 30.0, macro -40.0 with
    total weight 1.0:  0 + 7.0 + 7.5 - 8.0 = 6.5."""
    objective = calculate_objective_score(
        market="USStock",
        indicators=make_indicators(rsi=50.0),
        fundamental={
            "pe_ratio": 30,
            "roe": 12,
            "revenue_growth": 5,
            "profit_margin": 15,
            "debt_to_equity": 1.0,
        },
        news=[{"sentiment": "positive"}, {"sentiment": "neutral"}],
        macro={"VIX": {"price": 40.0}},
    )
    assert objective.technical_score == approx(0.0)
    assert objective.fundamental_score == approx(35.0)
    assert objective.sentiment_score == approx(30.0)
    assert objective.macro_score == approx(-40.0)
    assert objective.overall_score == approx(6.5)


def test_objective_skips_fundamentals_for_a_non_equity_market() -> None:
    """Same inputs as above but on Forex: the fundamental slice drops out of
    both the numerator and the divisor.  (0 + 7.5 - 8.0) / 0.80 = -0.625."""
    objective = calculate_objective_score(
        market="Forex",
        indicators=make_indicators(rsi=50.0),
        fundamental={"pe_ratio": 30, "profit_margin": 15},
        news=[{"sentiment": "positive"}, {"sentiment": "neutral"}],
        macro={"VIX": {"price": 40.0}},
    )
    assert objective.fundamental_present is False
    assert objective.overall_score == approx(-0.625)


def test_objective_fundamental_needs_a_meaningful_field_not_just_a_dict() -> None:
    empty = calculate_objective_score(
        market="USStock", indicators=make_indicators(rsi=50.0), fundamental={"name": "Acme"}
    )
    assert empty.fundamental_present is False

    meaningful = calculate_objective_score(
        market="USStock", indicators=make_indicators(rsi=50.0), fundamental={"roe": 17}
    )
    assert meaningful.fundamental_present is True


def test_objective_crypto_replaces_the_fundamental_slot_with_factor_flow() -> None:
    objective = calculate_objective_score(
        market="Crypto",
        indicators=make_indicators(rsi=50.0),
        crypto_factors={"exchange_netflow": -1000.0},
    )
    assert objective.fundamental_present is True
    assert objective.fundamental_score == approx(16.0)
    assert objective.crypto_factor_score == approx(16.0)


def test_objective_falls_back_to_technical_when_nothing_is_present() -> None:
    """An empty indicator snapshot leaves total weight at 0; upstream returns
    the technical score rather than dividing by zero."""
    objective = calculate_objective_score(market="Forex", indicators=TimeframeIndicators())
    assert objective.technical_present is False
    assert objective.overall_score == approx(objective.technical_score)
