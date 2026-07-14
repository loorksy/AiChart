from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.config import Settings
from app.security import CallerContext
from app.storage.artifacts import ArtifactStore
from app.swarm.manager import ResearchSwarmManager
from app.swarm.models import (
    RUN_TERMINAL_STATES,
    ClaimStatus,
    GroundedClaim,
    GroundedTaskOutput,
    RequestedSwarmBudgets,
    SwarmCreateRequest,
    SwarmUsage,
    WorkerResult,
)
from app.swarm.store import SwarmStore
from app.swarm.worker import TaskExecutionContext


class TrackingWorker:
    def __init__(self, usage: SwarmUsage | None = None) -> None:
        self.active = 0
        self.maximum = 0
        self.usage = usage or SwarmUsage(token_count=10)

    async def run(self, context: TaskExecutionContext) -> WorkerResult:
        self.active += 1
        self.maximum = max(self.maximum, self.active)
        try:
            await asyncio.sleep(0.03)
            await context.heartbeat()
            return WorkerResult(
                output=GroundedTaskOutput(
                    public_summary="bounded tracking output",
                    hypotheses=[
                        GroundedClaim(
                            claim_id=f"{context.task.task_id}.insufficient",
                            statement="insufficient_evidence",
                            status=ClaimStatus.INSUFFICIENT_EVIDENCE,
                        )
                    ],
                    limitations=["insufficient_evidence"],
                ),
                usage=self.usage,
            )
        finally:
            self.active -= 1


class StaleWorker:
    async def run(self, _: TaskExecutionContext) -> WorkerResult:
        await asyncio.sleep(5)
        raise AssertionError("stale worker should be cancelled")


def _settings(tmp_path: Path, *, stale_seconds: int = 2) -> Settings:
    return Settings(
        internal_token="runtime-test-token-with-32-characters",
        environment="test",
        work_dir=tmp_path / "work",
        artifact_dir=tmp_path / "artifacts",
        max_artifact_bytes=128 * 1024,
        swarm_enabled=True,
        swarm_presets_enabled=True,
        swarm_db_path=tmp_path / "work" / "swarm.sqlite3",
        swarm_stale_seconds=stale_seconds,
        swarm_artifact_bytes=128 * 1024,
    )


async def _manager(
    settings: Settings, worker: TrackingWorker | StaleWorker
) -> ResearchSwarmManager:
    artifacts = ArtifactStore(settings.artifact_dir, settings.max_artifact_bytes)
    await artifacts.initialize()
    assert settings.swarm_db_path is not None
    store = SwarmStore(settings.swarm_db_path, max_events=settings.swarm_progress_event_count)
    manager = ResearchSwarmManager(settings, store, artifacts, worker)  # type: ignore[arg-type]
    await manager.start()
    return manager


async def _wait(manager: ResearchSwarmManager, run_id: str, attempts: int = 500):
    for _ in range(attempts):
        run = await manager.store.get_internal(run_id)
        if run and run.status in RUN_TERMINAL_STATES:
            return run
        await asyncio.sleep(0.01)
    raise AssertionError("run did not finish")


@pytest.mark.asyncio
async def test_requested_max_workers_and_graceful_shutdown_leave_no_orphans(
    tmp_path: Path,
) -> None:
    worker = TrackingWorker()
    manager = await _manager(_settings(tmp_path), worker)
    run, _ = await manager.create(
        SwarmCreateRequest(
            preset="weekly_market_research",
            title="Concurrency test",
            objective="Bounded worker concurrency",
            idempotency_key="worker-limit-001",
            budgets=RequestedSwarmBudgets(max_workers=1),
        ),
        CallerContext(1, "req-worker", "test"),
    )
    assert (await _wait(manager, run.swarm_run_id)).status.value == "succeeded"
    assert worker.maximum == 1
    await manager.stop()
    assert not [
        task
        for task in asyncio.all_tasks()
        if not task.done() and task.get_name().startswith(("swarm-", "swarm-run-worker-"))
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("usage", "budgets"),
    [
        (SwarmUsage(token_count=10, cost=0.1), RequestedSwarmBudgets(cost_budget=0)),
        (SwarmUsage(token_count=10, tool_calls=1), RequestedSwarmBudgets(tool_call_budget=0)),
    ],
)
async def test_cost_and_tool_call_budgets_stop_new_work(
    tmp_path: Path, usage: SwarmUsage, budgets: RequestedSwarmBudgets
) -> None:
    manager = await _manager(_settings(tmp_path), TrackingWorker(usage))
    run, _ = await manager.create(
        SwarmCreateRequest(
            preset="forex_research_committee",
            title="Usage budget test",
            objective="Stop on server budget",
            idempotency_key="usage-budget-001",
            budgets=budgets,
        ),
        CallerContext(1, "req-usage", "test"),
    )
    assert (await _wait(manager, run.swarm_run_id)).status.value == "failed"
    events = await manager.store.events_for_user(run.swarm_run_id, 1) or []
    assert any(event.event_type == "budget_exhausted" for event in events)
    await manager.stop()


@pytest.mark.asyncio
async def test_missed_heartbeat_cancels_stale_workers(tmp_path: Path) -> None:
    manager = await _manager(_settings(tmp_path, stale_seconds=1), StaleWorker())
    run, _ = await manager.create(
        SwarmCreateRequest(
            preset="forex_research_committee",
            title="Stale worker test",
            objective="Detect a missing heartbeat",
            idempotency_key="stale-worker-001",
        ),
        CallerContext(1, "req-stale", "test"),
    )
    assert (await _wait(manager, run.swarm_run_id, attempts=800)).status.value == "failed"
    events = await manager.store.events_for_user(run.swarm_run_id, 1) or []
    assert any(event.event_type == "heartbeat_missed" for event in events)
    await manager.stop()
