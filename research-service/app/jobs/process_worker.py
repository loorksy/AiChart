"""Killable process isolation for CPU-bound job work (RELIABILITY_PLAN item 3).

Why a process and not a thread: ``asyncio.to_thread`` moved the simulation off
the event loop (so health checks survive), but cancelling the awaiting task
CANNOT stop the thread. A run that ignores its cooperative cancel flag keeps a
core busy while the job is already marked ``timed_out`` — and a new job can
start on top of it. A child process can always be killed.

Guarantees provided here:

- **Hard kill.** Cancellation/timeout escalates: cooperative event → SIGTERM
  (``terminate``) after a grace period → SIGKILL (``kill``). The function never
  returns while the child is still alive.
- **Lease / heartbeat.** The child stamps a shared heartbeat while it works. If
  the stamp goes stale (crashed child, wedged in C code, machine suspended) the
  parent treats the job as orphaned and kills it instead of waiting forever.
- **Loop safety.** Every wait is an ``await asyncio.sleep`` poll, never a
  blocking ``join()``, so the API event loop keeps serving ``/health`` while the
  biggest backtest runs.

The payload must be picklable: pass plain data and build heavy objects inside
the child (see ``app.jobs.backtest_process``).
"""

from __future__ import annotations

import asyncio
import multiprocessing
import time
from dataclasses import dataclass
from typing import Any, Callable

from app.jobs.cancellation import JobCancelled

#: How often the child refreshes its heartbeat and the parent polls.
HEARTBEAT_INTERVAL_SECONDS = 1.0
#: No heartbeat for this long ⇒ the child is considered orphaned and killed.
DEFAULT_LEASE_SECONDS = 30.0
#: Grace between "please stop" (cooperative + SIGTERM) and SIGKILL.
DEFAULT_KILL_GRACE_SECONDS = 5.0


class ProcessWorkerError(RuntimeError):
    """The child failed in a way the job layer must surface as a job failure."""


class ProcessLeaseExpired(ProcessWorkerError):
    """The child stopped heartbeating; it was killed as orphaned."""


@dataclass
class _ChildOutcome:
    ok: bool
    value: Any = None
    error_type: str | None = None
    error_message: str | None = None


def _child_main(
    func: Callable[..., Any],
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
    result_queue: Any,
    heartbeat: Any,
    stop_event: Any,
) -> None:
    """Entry point INSIDE the child process. Must stay import-light and simple."""
    # Stamp immediately so a slow start is not mistaken for a dead child.
    heartbeat.value = time.time()

    def _beat() -> None:
        heartbeat.value = time.time()

    def _should_stop() -> bool:
        return bool(stop_event.is_set())

    try:
        value = func(*args, _beat=_beat, _should_stop=_should_stop, **kwargs)
        result_queue.put(_ChildOutcome(ok=True, value=value))
    except BaseException as exc:  # noqa: BLE001 - the boundary must report everything
        result_queue.put(
            _ChildOutcome(
                ok=False,
                error_type=type(exc).__name__,
                error_message=str(exc)[:2000],
            )
        )
    finally:
        heartbeat.value = time.time()


async def run_in_killable_process(
    func: Callable[..., Any],
    *args: Any,
    timeout_seconds: float,
    cancelled: asyncio.Event | None = None,
    lease_seconds: float = DEFAULT_LEASE_SECONDS,
    kill_grace_seconds: float = DEFAULT_KILL_GRACE_SECONDS,
    **kwargs: Any,
) -> Any:
    """Run ``func`` in a child process that can always be killed.

    ``func`` receives ``_beat`` (call periodically to refresh the lease) and
    ``_should_stop`` (poll for cooperative cancellation) in addition to its own
    arguments. Raises :class:`JobCancelled` on cancellation, ``TimeoutError`` on
    deadline, and :class:`ProcessWorkerError` when the child dies abnormally —
    matching what the job manager already handles.
    """
    ctx = multiprocessing.get_context("spawn")
    result_queue: Any = ctx.Queue(maxsize=1)
    heartbeat: Any = ctx.Value("d", time.time())
    stop_event: Any = ctx.Event()

    process = ctx.Process(
        target=_child_main,
        args=(func, args, kwargs, result_queue, heartbeat, stop_event),
        daemon=True,
    )
    process.start()

    started = time.monotonic()
    outcome: _ChildOutcome | None = None
    failure: BaseException | None = None

    try:
        while True:
            # 1) Did the child finish?
            if not result_queue.empty():
                outcome = result_queue.get_nowait()
                break

            # 2) Child died without reporting (segfault / OOM kill / hard exit).
            if not process.is_alive():
                await asyncio.sleep(0.05)  # let a queued result land first
                if not result_queue.empty():
                    outcome = result_queue.get_nowait()
                    break
                failure = ProcessWorkerError(
                    f"worker process exited abnormally (exitcode={process.exitcode})"
                )
                break

            # 3) Cancellation requested by the operator/manager.
            if cancelled is not None and cancelled.is_set():
                failure = JobCancelled()
                break

            # 4) Deadline.
            if time.monotonic() - started >= timeout_seconds:
                failure = TimeoutError("job exceeded its approved timeout")
                break

            # 5) Lease: a child that stopped heartbeating is orphaned.
            if time.time() - float(heartbeat.value) > lease_seconds:
                failure = ProcessLeaseExpired(
                    f"worker heartbeat stale for more than {lease_seconds:.0f}s"
                )
                break

            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
    finally:
        await _stop_process(process, stop_event, kill_grace_seconds)
        _drain_queue(result_queue)

    if failure is not None:
        raise failure
    if outcome is None:  # pragma: no cover - defensive
        raise ProcessWorkerError("worker produced no result")
    if not outcome.ok:
        raise ProcessWorkerError(f"{outcome.error_type}: {outcome.error_message}")
    return outcome.value


async def _stop_process(process: Any, stop_event: Any, grace_seconds: float) -> None:
    """Escalate cooperative → terminate → kill. Never returns with a live child."""
    if not process.is_alive():
        process.join(timeout=0)
        return

    # a) Ask nicely: the child polls this between bars.
    stop_event.set()
    if await _wait_exit(process, grace_seconds):
        return

    # b) SIGTERM.
    process.terminate()
    if await _wait_exit(process, grace_seconds):
        return

    # c) SIGKILL — a run that ignores cancellation cannot outlive its job.
    process.kill()
    await _wait_exit(process, grace_seconds)


async def _wait_exit(process: Any, seconds: float) -> bool:
    """Poll for exit without blocking the event loop."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not process.is_alive():
            process.join(timeout=0)
            return True
        await asyncio.sleep(0.05)
    return not process.is_alive()


def _drain_queue(queue: Any) -> None:
    try:
        while not queue.empty():
            queue.get_nowait()
    except Exception:  # noqa: BLE001 - best-effort cleanup
        pass
    try:
        queue.close()
    except Exception:  # noqa: BLE001
        pass
