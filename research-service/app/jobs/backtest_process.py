"""Child-process entry point for a deterministic backtest run.

Kept in its own module (and free of loop/state imports) so the ``spawn`` start
method can import it cleanly in the child. The heavy engine is BUILT INSIDE the
child from plain inputs — only picklable data crosses the boundary.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from app.backtest.engine import BacktestEngine


class _ChildCancellation:
    """Adapter matching the engine's ``cancelled.is_set()`` contract.

    The engine polls this once per bar, which makes it the natural heartbeat
    site: every poll refreshes the lease, so "still working" and "still alive"
    are the same signal — a wedged run stops beating and the parent's lease
    catches it.
    """

    __slots__ = ("_beat", "_should_stop")

    def __init__(self, beat: Callable[[], None], should_stop: Callable[[], bool]) -> None:
        self._beat = beat
        self._should_stop = should_stop

    def is_set(self) -> bool:
        self._beat()
        return self._should_stop()


def run_backtest_in_child(
    strategy: Any,
    dataset: Any,
    run_config: Any,
    *,
    _beat: Callable[[], None],
    _should_stop: Callable[[], bool],
) -> Any:
    """Build and run the engine in this child process; return its result."""
    engine = BacktestEngine(strategy, dataset, run_config)
    cancellation = _ChildCancellation(_beat, _should_stop)
    return asyncio.run(engine.run(cancellation))
