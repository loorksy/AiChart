from __future__ import annotations

from typing import Any

from app.engine.features import Features, compute_features
from app.engine.strategies.generated_code.interpreter import GeneratedCodeStrategy
from app.storage.models import Bar
from tests.fixtures import bars_no_signal, bars_triggering_ema_trend_buy

_FIRES_WHEN_ATR_AVAILABLE = """
def evaluate(features):
    idx = features['last']
    atr = features['atr14']
    if idx < 0 or idx >= len(atr) or atr[idx] is None:
        return None
    return {
        'direction': 'buy',
        'stop_loss_atr_multiple': 1.5,
        'take_profit_r_multiples': [1.0, 2.0, 3.0],
        'rationale': 'fires whenever ATR is available',
    }
"""

_NEVER_FIRES = """
def evaluate(features):
    return None
"""

_ALWAYS_RAISES = """
def evaluate(features):
    raise RuntimeError('deliberately broken generated code')
"""

_INFINITE_LOOP = """
def evaluate(features):
    while True:
        pass
"""


def _features(raw_bars: list[dict[str, Any]]) -> Features:
    bars = [Bar.model_validate(raw) for raw in raw_bars]
    return compute_features("EURUSD", "forex", "M15", bars)


def _strategy(source_code: str) -> GeneratedCodeStrategy:
    return GeneratedCodeStrategy(
        strategy_id="sandboxed_test_v1",
        version="1.0.0",
        display_name="Sandboxed Test Strategy",
        description="test-only sandboxed-code strategy",
        regime_affinity="trend",
        source_code=source_code,
    )


def test_generated_code_strategy_fires_and_produces_a_valid_signal() -> None:
    strategy = _strategy(_FIRES_WHEN_ATR_AVAILABLE)
    features = _features(bars_triggering_ema_trend_buy())

    signal = strategy.evaluate(features)

    assert signal is not None
    assert signal.strategy_id == "sandboxed_test_v1"
    assert signal.direction == "buy"
    assert signal.plan_type == "immediate"
    assert signal.stop_loss < signal.entry
    assert len(signal.targets) == 3
    assert signal.targets[0] < signal.targets[1] < signal.targets[2]


def test_generated_code_strategy_returns_none_when_evaluate_returns_none() -> None:
    strategy = _strategy(_NEVER_FIRES)
    features = _features(bars_triggering_ema_trend_buy())

    assert strategy.evaluate(features) is None


def test_generated_code_strategy_never_raises_when_user_code_raises() -> None:
    strategy = _strategy(_ALWAYS_RAISES)
    features = _features(bars_triggering_ema_trend_buy())

    assert strategy.evaluate(features) is None


def test_generated_code_strategy_never_raises_on_timeout() -> None:
    strategy = _strategy(_INFINITE_LOOP)
    features = _features(bars_triggering_ema_trend_buy())

    assert strategy.evaluate(features) is None


def test_generated_code_strategy_never_raises_on_insufficient_history() -> None:
    strategy = _strategy(_FIRES_WHEN_ATR_AVAILABLE)
    truncated = _features(bars_triggering_ema_trend_buy()[:1])

    assert strategy.evaluate(truncated) is None


def test_generated_code_strategy_no_signal_fixture_produces_no_atr_gap_signal() -> None:
    strategy = _strategy(_FIRES_WHEN_ATR_AVAILABLE)
    features = _features(bars_no_signal())

    # This strategy only depends on ATR availability, not on the DSL
    # strategies' own trigger conditions, so it may legitimately fire here --
    # the point of this test is only that it never raises either way.
    strategy.evaluate(features)
