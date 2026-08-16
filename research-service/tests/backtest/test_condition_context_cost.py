"""The cost of resolving a condition's bar index.

This is the file that made a backtest take minutes. `ConditionContext.index`
rebuilt every bar's close time into a fresh list on EVERY call — an O(n) list
construction performed in order to run an O(log n) bisect over it. The engine
creates one context per bar and each condition leaf resolves its own index, so a
50,000-bar run with four leaves rebuilt a 50,000-element list 200,000 times.

Ten billion operations to answer a question whose inputs never change, and none
of it visible in a profile as anything but "the engine is slow".

These tests pin the fix at the level it matters: the work is done ONCE per
(symbol, timeframe) for the life of a run, the answer is identical to the naive
computation, and the shared cache is what carries it between contexts.
"""

from __future__ import annotations

import bisect
from datetime import UTC, datetime, timedelta
from typing import Any

from app.backtest.conditions import ConditionContext
from app.backtest.policies import TIMEFRAME_MINUTES


class _Bar:
    __slots__ = ("timestamp", "symbol", "open", "high", "low", "close", "volume")

    def __init__(self, timestamp: datetime, close: float) -> None:
        self.timestamp = timestamp
        self.symbol = "XAUUSD"
        self.open = self.high = self.low = self.close = close
        self.volume = 1


def _bars(count: int, timeframe: str = "15m") -> list[_Bar]:
    start = datetime(2024, 1, 1, tzinfo=UTC)
    step = timedelta(minutes=TIMEFRAME_MINUTES[timeframe])
    return [_Bar(start + step * i, 4000 + (i % 25)) for i in range(count)]


def _naive_index(bars: list[Any], timeframe: str, decision_time: datetime) -> int:
    duration = TIMEFRAME_MINUTES[timeframe] * 60
    close_times = [bar.timestamp.timestamp() + duration for bar in bars]
    return bisect.bisect_right(close_times, decision_time.timestamp()) - 1


def test_index_matches_the_naive_computation() -> None:
    """Memoisation must change the cost and nothing else."""
    bars = _bars(200)
    frames = {"15m": bars}
    shared: dict = {}
    for probe in (0, 1, 37, 199):
        decision_time = bars[probe].timestamp + timedelta(minutes=15)
        context = ConditionContext(frames, decision_time, "15m", shared)
        assert context.index("15m") == _naive_index(bars, "15m", decision_time)


def test_index_is_negative_before_the_first_close() -> None:
    """A decision earlier than any closed bar has no index, cached or not."""
    bars = _bars(10)
    frames = {"15m": bars}
    shared: dict = {}
    before = bars[0].timestamp - timedelta(minutes=1)
    context = ConditionContext(frames, before, "15m", shared)
    assert context.index("15m") == -1
    # And again from the cache, rather than accidentally serving bar 0.
    assert context.index("15m") == -1


def test_close_times_are_built_once_for_the_whole_run() -> None:
    """The fix itself: one array per (symbol, timeframe), not one per call.

    Asserted through the shared cache rather than by patching the method: the
    cache key is the observable contract, and a test that patched
    `_close_times` would still pass if the cache were bypassed entirely.
    """
    bars = _bars(500)
    frames = {"15m": bars}
    shared: dict = {}

    for bar in bars:
        context = ConditionContext(frames, bar.timestamp + timedelta(minutes=15), "15m", shared)
        # Two leaves, as a real strategy has.
        context.index("15m")
        context.bars("15m")

    close_time_keys = [key for key in shared if key[2] == "__close_times__"]
    assert len(close_time_keys) == 1, "one array for one (symbol, timeframe)"
    assert len(shared[close_time_keys[0]]) == len(bars)


def test_index_is_resolved_once_per_context() -> None:
    """Within one bar, every leaf asks the same question and gets one answer."""
    bars = _bars(50)
    frames = {"15m": bars}
    context = ConditionContext(frames, bars[10].timestamp + timedelta(minutes=15), "15m", {})
    first = context.index("15m")
    assert context._index_cache == {"15m": first}
    # Repeated resolution stays consistent and adds no entries.
    for _ in range(5):
        assert context.index("15m") == first
    assert len(context._index_cache) == 1


def test_separate_timeframes_keep_separate_arrays() -> None:
    """A cache that collapsed timeframes would answer with the wrong bars."""
    frames = {"15m": _bars(100, "15m"), "1h": _bars(30, "1h")}
    shared: dict = {}
    decision_time = frames["15m"][50].timestamp + timedelta(minutes=15)
    context = ConditionContext(frames, decision_time, "15m", shared)
    assert context.index("15m") == _naive_index(frames["15m"], "15m", decision_time)
    assert context.index("1h") == _naive_index(frames["1h"], "1h", decision_time)
    keys = [key for key in shared if key[2] == "__close_times__"]
    assert len(keys) == 2
