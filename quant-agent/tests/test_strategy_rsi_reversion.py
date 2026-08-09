from __future__ import annotations

from app.engine.features import compute_features
from app.engine.strategies.rsi_reversion_v1 import RsiReversionV1
from app.storage.models import Bar
from tests.fixtures import bars_no_signal, bars_triggering_rsi_reversion_buy


def _features(raw_bars):
    bars = [Bar.model_validate(raw) for raw in raw_bars]
    return compute_features("EURUSD", "forex", "M15", bars)


def test_rsi_reversion_fires_buy_on_oversold_band_touch_fixture() -> None:
    features = _features(bars_triggering_rsi_reversion_buy())
    assert features.regime == "range"
    signal = RsiReversionV1().evaluate(features)
    assert signal is not None
    assert signal.strategy_id == "rsi_reversion_v1"
    assert signal.direction == "buy"
    assert signal.plan_type == "immediate"
    assert signal.regime == "range"
    assert signal.stop_loss < signal.entry  # buy: stop below entry
    assert signal.take_profit == features.bb_middle[-1]
    assert any("oversold" in fragment for fragment in signal.rationale)


def test_rsi_reversion_does_not_fire_on_flat_market() -> None:
    features = _features(bars_no_signal())
    assert RsiReversionV1().evaluate(features) is None


def test_rsi_reversion_gate_blocks_outside_range_regime() -> None:
    features = _features(bars_triggering_rsi_reversion_buy())
    # Sanity check the gate itself: force a non-"range" regime and confirm
    # the strategy refuses to fire even with an otherwise-identical snapshot.
    features.regime = "trend"
    assert RsiReversionV1().evaluate(features) is None
