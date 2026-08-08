from __future__ import annotations

from app.engine.features import compute_features
from app.engine.strategies.ema_trend_v1 import EmaTrendV1
from app.engine.strategies.rsi_reversion_v1 import RsiReversionV1
from app.storage.models import Bar
from tests.fixtures import bars_no_signal, bars_triggering_ema_trend_buy


def _features(raw_bars):
    bars = [Bar.model_validate(raw) for raw in raw_bars]
    return compute_features("EURUSD", "forex", "M15", bars)


def test_ema_trend_fires_buy_on_crossover_fixture() -> None:
    features = _features(bars_triggering_ema_trend_buy())
    signal = EmaTrendV1().evaluate(features)
    assert signal is not None
    assert signal.strategy_id == "ema_trend_v1"
    assert signal.direction == "buy"
    assert signal.regime == "trend"
    assert signal.stop_loss < signal.entry  # buy: stop below entry
    assert len(signal.targets) == 3
    assert signal.targets[0] < signal.targets[1] < signal.targets[2]
    assert any("EMA20 crossed above EMA50" in fragment for fragment in signal.rationale)
    assert any("ADX14=" in fragment for fragment in signal.rationale)


def test_ema_trend_does_not_fire_on_flat_market() -> None:
    features = _features(bars_no_signal())
    assert EmaTrendV1().evaluate(features) is None


def test_ema_trend_requires_history_for_a_cross() -> None:
    # Truncating the series so there is no previous bar to compare against
    # must never raise, only return None.
    truncated = _features(bars_triggering_ema_trend_buy()[:1])
    assert EmaTrendV1().evaluate(truncated) is None


def test_ema_trend_and_rsi_reversion_gates_are_mutually_exclusive_in_practice() -> None:
    """Documents the design note in engine/combine.py: under the real
    strategy gates (raw ADX14>20 vs regime=='range'), the two strategies do
    not fire on the same ordinary bar."""
    trend_features = _features(bars_triggering_ema_trend_buy())
    assert RsiReversionV1().evaluate(trend_features) is None
