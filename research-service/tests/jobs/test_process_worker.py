"""Fault tests for killable process isolation (RELIABILITY_PLAN item 3).

The critical property: a job that IGNORES cooperative cancellation must still
be stopped, and the event loop must stay responsive the whole time (a real
`/health` check has to succeed while the runaway job is being killed).
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.jobs.cancellation import JobCancelled
from app.jobs.process_worker import (
    ProcessLeaseExpired,
    ProcessWorkerError,
    run_in_killable_process,
)

pytestmark = pytest.mark.anyio if False else pytest.mark.asyncio


# --- child-process entry points (must be top-level + picklable) --------------


def _cooperative_task(value: int, *, _beat, _should_stop) -> int:
    """Well-behaved: beats and honors the stop flag."""
    for _ in range(50):
        if _should_stop():
            return -1
        _beat()
        time.sleep(0.01)
    return value * 2


def _runaway_task(*, _beat, _should_stop) -> int:
    """Malicious/wedged: never checks _should_stop, keeps a core busy.

    It DOES keep beating, so the lease cannot save us — only a hard kill can.
    """
    end = time.time() + 120
    while time.time() < end:
        _beat()
        time.sleep(0.01)
    return 0


def _silent_task(*, _beat, _should_stop) -> int:
    """Wedged without heartbeats — the lease must catch it."""
    time.sleep(120)
    return 0


def _exploding_task(*, _beat, _should_stop) -> int:
    raise ValueError("boom inside the child")


def _hard_exit_task(*, _beat, _should_stop) -> int:
    """Dies without reporting (simulates OOM-kill / segfault)."""
    import os

    os._exit(9)


# --- tests -------------------------------------------------------------------


async def test_returns_child_result() -> None:
    result = await run_in_killable_process(_cooperative_task, 21, timeout_seconds=30)
    assert result == 42


async def test_cooperative_cancellation_stops_the_child() -> None:
    cancelled = asyncio.Event()

    async def cancel_soon() -> None:
        await asyncio.sleep(0.2)
        cancelled.set()

    asyncio.create_task(cancel_soon())
    with pytest.raises(JobCancelled):
        await run_in_killable_process(
            _cooperative_task, 21, timeout_seconds=30, cancelled=cancelled
        )


async def test_runaway_job_is_force_killed_and_loop_stays_responsive() -> None:
    """A job that ignores cancellation is KILLED, and /health-style work keeps
    running throughout — the regression that motivated process isolation."""
    cancelled = asyncio.Event()
    health_ticks = 0
    stop_health = False

    async def health_probe() -> None:
        nonlocal health_ticks
        while not stop_health:
            health_ticks += 1
            await asyncio.sleep(0.05)

    probe = asyncio.create_task(health_probe())

    async def cancel_soon() -> None:
        await asyncio.sleep(0.3)
        cancelled.set()

    asyncio.create_task(cancel_soon())

    started = time.monotonic()
    with pytest.raises(JobCancelled):
        await run_in_killable_process(
            _runaway_task,
            timeout_seconds=60,
            cancelled=cancelled,
            kill_grace_seconds=1.0,
        )
    elapsed = time.monotonic() - started

    stop_health = True
    await probe

    # The runaway would have run for 120s; escalation must end it far sooner.
    assert elapsed < 30, f"force-kill took too long ({elapsed:.1f}s)"
    # The event loop kept serving other work the entire time.
    assert health_ticks > 3, f"event loop was starved (only {health_ticks} ticks)"


async def test_timeout_kills_the_child() -> None:
    started = time.monotonic()
    with pytest.raises(TimeoutError):
        await run_in_killable_process(
            _runaway_task, timeout_seconds=1.0, kill_grace_seconds=1.0
        )
    assert time.monotonic() - started < 30


async def test_stale_lease_is_detected_as_orphaned() -> None:
    with pytest.raises(ProcessLeaseExpired):
        await run_in_killable_process(
            _silent_task,
            timeout_seconds=60,
            lease_seconds=2.0,
            kill_grace_seconds=1.0,
        )


async def test_child_exception_surfaces_as_worker_error() -> None:
    with pytest.raises(ProcessWorkerError, match="boom inside the child"):
        await run_in_killable_process(_exploding_task, timeout_seconds=30)


async def test_abnormal_child_exit_is_reported_not_hung() -> None:
    with pytest.raises(ProcessWorkerError):
        await run_in_killable_process(_hard_exit_task, timeout_seconds=30)
