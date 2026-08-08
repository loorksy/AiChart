"""Coverage for `replay_strategy` and its precomputed-indicator-series
optimization (plan section 1). Two kinds of checks:

  1. Equivalence: the sliced-precomputed `Features` built per step must be
     bit-for-bit identical to what a naive `compute_features(bars[:i+1])`
     call would produce (including `.regime`) -- this is the actual claim
     item 1 makes, checked directly rather than trusted on faith.
  2. A performance sanity check that the `GeneratedCodeStrategy` batch path
     is genuinely being used for a several-thousand-bar replay (fast), not
     silently regressed to one subprocess spawn per bar (slow).
"""

from __future__ import annotations

import math
import time

from app.engine.backtest.replay import _features_at, _precompute_series, replay_strategy
from app.engine.features import compute_features
from app.engine.strategies.ema_trend_v1 import EmaTrendV1
from app.engine.strategies.generated_code.interpreter import GeneratedCodeStrategy
from app.storage.models import Bar
from tests.fixtures import bars_triggering_ema_trend_buy, make_bars

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


def _bars() -> list[Bar]:
    return [Bar.model_validate(raw) for raw in bars_triggering_ema_trend_buy()]


def test_features_at_matches_naive_compute_features_for_several_steps() -> None:
    bars = _bars()
    series = _precompute_series(bars)
    for index in (209, 210, 211, len(bars) - 1):
        sliced = _features_at("EURUSD", "forex", "M15", series, index)
        naive = compute_features("EURUSD", "forex", "M15", bars[: index + 1])
        assert sliced == naive
        assert sliced.regime == naive.regime


def test_replay_strategy_ema_trend_matches_naive_per_step_evaluate() -> None:
    bars = _bars()
    strategy = EmaTrendV1()
    min_bars = 210

    fired = replay_strategy(strategy, "EURUSD", "forex", "M15", bars, min_bars)

    expected: list[tuple[int, object]] = []
    for index in range(min_bars - 1, len(bars)):
        features = compute_features("EURUSD", "forex", "M15", bars[: index + 1])
        signal = strategy.evaluate(features)
        if signal is not None:
            expected.append((index, signal))

    assert [index for index, _ in fired] == [index for index, _ in expected]
    for (_, fired_signal), (_, expected_signal) in zip(fired, expected, strict=True):
        assert fired_signal == expected_signal
    # The fixture is tuned (see tests/fixtures.py) to fire exactly once, on
    # the final bar -- confirm that precisely, not just "matches expected".
    assert len(fired) == 1
    assert fired[0][0] == len(bars) - 1
    assert fired[0][1].direction == "buy"


def test_replay_strategy_returns_empty_for_insufficient_bars() -> None:
    bars = _bars()[:5]
    fired = replay_strategy(EmaTrendV1(), "EURUSD", "forex", "M15", bars, 210)
    assert fired == []


def _generated_code_strategy(source_code: str = _FIRES_WHEN_ATR_AVAILABLE) -> GeneratedCodeStrategy:
    return GeneratedCodeStrategy(
        strategy_id="sandboxed_test_v1",
        version="1.0.0",
        display_name="Sandboxed Test Strategy",
        description="test-only sandboxed-code strategy",
        regime_affinity="trend",
        source_code=source_code,
    )


def test_replay_strategy_generated_code_batch_matches_live_per_bar_path() -> None:
    """Same code, same bars: the ONE batched sandbox call replay_strategy
    makes for a `GeneratedCodeStrategy` must produce exactly the signals a
    naive per-step `.evaluate()` call (the live path) would have produced."""
    bars = _bars()
    strategy = _generated_code_strategy()
    min_bars = 210

    fired = replay_strategy(strategy, "EURUSD", "forex", "M15", bars, min_bars)

    expected: list[tuple[int, object]] = []
    for index in range(min_bars - 1, len(bars)):
        features = compute_features("EURUSD", "forex", "M15", bars[: index + 1])
        signal = strategy.evaluate(features)
        if signal is not None:
            expected.append((index, signal))

    assert [index for index, _ in fired] == [index for index, _ in expected]
    for (_, fired_signal), (_, expected_signal) in zip(fired, expected, strict=True):
        assert fired_signal == expected_signal
    assert len(fired) > 0


def _many_bars(count: int) -> list[Bar]:
    prices = [1.1000 + 0.0010 * math.sin(2 * math.pi * i / 50) for i in range(count)]
    raw = make_bars(prices, interval_minutes=15)
    return [Bar.model_validate(item) for item in raw]


def test_replay_strategy_generated_code_batch_is_fast_for_thousands_of_bars() -> None:
    """Performance sanity check (plan verification section): a
    several-thousand-bar replay of a sandboxed-code strategy must complete
    in seconds, not minutes -- proof the ONE-subprocess batch mechanism is
    actually engaged, not a per-bar subprocess-spawn regression (which,
    at ~2800 steps, would take vastly longer than this generous bound)."""
    bars = _many_bars(3000)
    strategy = _generated_code_strategy()

    start = time.monotonic()
    fired = replay_strategy(strategy, "EURUSD", "forex", "M15", bars, 210)
    elapsed = time.monotonic() - start

    assert len(fired) > 0  # confirms real evaluate() calls actually ran
    assert elapsed < 30.0
