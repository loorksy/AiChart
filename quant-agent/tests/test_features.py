from __future__ import annotations

from app.engine.features import (
    adx,
    atr,
    bollinger,
    classify_regime,
    compute_features,
    ema,
    macd,
    rsi,
    sma,
)
from app.storage.models import Bar
from tests.fixtures import bars_no_signal, bars_triggering_ema_trend_buy


def test_sma_and_ema_basic() -> None:
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert sma(values, 3) == [None, None, 2.0, 3.0, 4.0]
    ema_values = ema(values, 3)
    assert ema_values[0] is None and ema_values[1] is None
    assert ema_values[2] == 2.0


def test_rsi_all_gains_is_100() -> None:
    values = [float(i) for i in range(1, 20)]
    values_rsi = rsi(values, 14)
    assert values_rsi[14] == 100.0


def test_macd_and_bollinger_shapes_match_input() -> None:
    values = [1.0 + 0.01 * i for i in range(60)]
    line, signal_line, hist = macd(values)
    assert len(line) == len(signal_line) == len(hist) == len(values)
    lower, middle, upper = bollinger(values, period=20)
    for index in range(19, len(values)):
        assert lower[index] is not None
        assert lower[index] <= middle[index] <= upper[index]  # type: ignore[operator]


def test_atr_and_adx_require_enough_history() -> None:
    highs = [1.001] * 10
    lows = [0.999] * 10
    closes = [1.0] * 10
    assert atr(highs, lows, closes, period=14) == [None] * 10
    assert adx(highs, lows, closes, period=14) == [None] * 10


def test_classify_regime_trend_vs_range() -> None:
    assert (
        classify_regime(
            adx_value=25.0,
            atr_value=0.001,
            atr_history=[0.001] * 10,
            volume_value=None,
            volume_history=[],
        )
        == "trend"
    )
    assert (
        classify_regime(
            adx_value=10.0,
            atr_value=0.001,
            atr_history=[0.001] * 10,
            volume_value=None,
            volume_history=[],
        )
        == "range"
    )


def test_classify_regime_high_volatility_override() -> None:
    regime = classify_regime(
        adx_value=25.0,
        atr_value=0.01,
        atr_history=[0.001] * 10,
        volume_value=None,
        volume_history=[],
    )
    assert regime == "high_volatility"


def test_classify_regime_low_liquidity_override() -> None:
    regime = classify_regime(
        adx_value=25.0,
        atr_value=0.001,
        atr_history=[0.001] * 10,
        volume_value=1.0,
        volume_history=[100.0] * 10,
    )
    assert regime == "low_liquidity"


def test_classify_regime_defaults_to_range_without_enough_history() -> None:
    assert (
        classify_regime(
            adx_value=None, atr_value=None, atr_history=[], volume_value=None, volume_history=[]
        )
        == "range"
    )


def test_compute_features_on_trending_fixture_reports_trend_regime() -> None:
    bars = [Bar.model_validate(raw) for raw in bars_triggering_ema_trend_buy()]
    features = compute_features("EURUSD", "forex", "M15", bars)
    assert len(features.closes) == len(bars)
    assert features.ema200[-1] is not None
    assert features.adx14[-1] is not None
    assert features.regime in {"trend", "high_volatility"}


def test_compute_features_on_flat_fixture_has_no_extreme_indicators() -> None:
    bars = [Bar.model_validate(raw) for raw in bars_no_signal()]
    features = compute_features("EURUSD", "forex", "M15", bars)
    rsi_value = features.rsi14[-1]
    assert rsi_value is not None
    assert 20 < rsi_value < 80
