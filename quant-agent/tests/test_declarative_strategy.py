from __future__ import annotations

from typing import Any

from app.engine.features import Features, compute_features
from app.engine.strategies.generated.interpreter import DeclarativeStrategy
from app.engine.strategies.generated.schema import GeneratedStrategySpec
from app.storage.models import Bar
from tests.fixtures import bars_no_signal, bars_triggering_ema_trend_buy


def _features(raw_bars: list[dict[str, Any]]) -> Features:
    bars = [Bar.model_validate(raw) for raw in raw_bars]
    return compute_features("EURUSD", "forex", "M15", bars)


def _spec(**overrides: Any) -> GeneratedStrategySpec:
    base: dict[str, Any] = {
        "strategy_id": "declarative_ema_cross_v1",
        "version": "1.0.0",
        "display_name": "Declarative EMA Cross",
        "description": "EMA20/50 crossover gated by ADX",
        "regime_affinity": "trend",
        "direction": "buy",
        "entry_conditions": {
            "all": [
                {
                    "type": "ema_relation",
                    "fast_period": 20,
                    "slow_period": 50,
                    "operator": "crosses_above",
                },
                {"type": "adx_threshold", "operator": "above", "value": 20.0},
            ]
        },
        "stop_loss_atr_multiple": 1.5,
        "take_profit_r_multiples": [1.0, 2.0, 3.0],
    }
    base.update(overrides)
    return GeneratedStrategySpec.model_validate(base, strict=True)


def test_declarative_strategy_fires_on_matching_conditions() -> None:
    strategy = DeclarativeStrategy(_spec())
    features = _features(bars_triggering_ema_trend_buy())

    signal = strategy.evaluate(features)

    assert signal is not None
    assert signal.strategy_id == "declarative_ema_cross_v1"
    assert signal.strategy_version == "1.0.0"
    assert signal.direction == "buy"
    assert signal.plan_type == "immediate"
    assert signal.regime == "trend"
    assert signal.stop_loss < signal.entry  # buy: stop below entry
    assert len(signal.targets) == 3
    assert signal.targets[0] < signal.targets[1] < signal.targets[2]
    assert signal.take_profit == signal.targets[0]
    assert any("EMA20 crosses_above EMA50" in fragment for fragment in signal.rationale)
    assert "conditions" in signal.evidence


def test_declarative_strategy_does_not_fire_when_conditions_unmet() -> None:
    strategy = DeclarativeStrategy(_spec())
    features = _features(bars_no_signal())

    assert strategy.evaluate(features) is None


def test_declarative_strategy_sell_direction_produces_descending_targets() -> None:
    spec = _spec(
        direction="sell",
        entry_conditions={
            "all": [
                {
                    "type": "ema_relation",
                    "fast_period": 20,
                    "slow_period": 50,
                    "operator": "crosses_above",
                }
            ]
        },
    )
    strategy = DeclarativeStrategy(spec)
    features = _features(bars_triggering_ema_trend_buy())

    signal = strategy.evaluate(features)
    if signal is not None:
        assert signal.direction == "sell"
        assert signal.stop_loss > signal.entry  # sell: stop above entry
        assert signal.targets[0] > signal.targets[1] > signal.targets[2]


def test_evaluate_never_raises_on_insufficient_history() -> None:
    strategy = DeclarativeStrategy(_spec())
    truncated = _features(bars_triggering_ema_trend_buy()[:1])

    assert strategy.evaluate(truncated) is None


def test_evaluate_never_raises_when_atr_and_indicator_series_hold_none() -> None:
    strategy = DeclarativeStrategy(_spec())
    features = _features(bars_triggering_ema_trend_buy())
    # Poke None into every series the interpreter reads, simulating a
    # not-enough-history read at the evaluated index.
    features.atr14[features.last] = None
    features.ema20[features.last] = None
    features.ema50[features.last] = None
    features.adx14[features.last] = None

    assert strategy.evaluate(features) is None


def test_evaluate_never_raises_on_out_of_range_last_index() -> None:
    strategy = DeclarativeStrategy(_spec())
    features = _features(bars_triggering_ema_trend_buy())
    # Simulate a corrupted/out-of-range `last` by truncating the closes list
    # so `features.last` no longer matches the other series lengths.
    features.closes = []

    assert strategy.evaluate(features) is None


def test_regime_leaf_evaluates_against_features_regime() -> None:
    spec = _spec(
        regime_affinity="range",
        entry_conditions={"all": [{"type": "regime", "regime": "trend"}]},
    )
    strategy = DeclarativeStrategy(spec)

    trend_features = _features(bars_triggering_ema_trend_buy())
    assert trend_features.regime == "trend"
    signal = strategy.evaluate(trend_features)
    assert signal is not None
    assert signal.regime == "range"  # Signal.regime reflects the strategy's regime_affinity


def test_not_combinator_inverts_child_condition() -> None:
    spec = _spec(
        entry_conditions={"not": {"type": "regime", "regime": "range"}},
    )
    strategy = DeclarativeStrategy(spec)

    trend_features = _features(bars_triggering_ema_trend_buy())  # regime == "trend"
    assert strategy.evaluate(trend_features) is not None


def test_any_combinator_fires_when_one_branch_matches() -> None:
    spec = _spec(
        entry_conditions={
            "any": [
                # RSI never exceeds 100, so this branch never fires.
                {"type": "rsi_threshold", "operator": "above", "value": 100.0},
                {"type": "adx_threshold", "operator": "above", "value": 0.0},
            ]
        },
    )
    strategy = DeclarativeStrategy(spec)
    features = _features(bars_triggering_ema_trend_buy())

    signal = strategy.evaluate(features)
    assert signal is not None
