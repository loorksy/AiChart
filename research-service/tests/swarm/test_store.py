from __future__ import annotations

from pathlib import Path

import pytest

from app.core.ids import opaque_id
from app.errors import ServiceError
from app.swarm.models import (
    ClaimStatus,
    GroundedClaim,
    GroundedTaskOutput,
    SwarmBudgets,
    SwarmCreateRequest,
    SwarmRunStatus,
    SwarmTaskStatus,
    SwarmUsage,
)
from app.swarm.presets import build_tasks, get_preset
from app.swarm.store import SwarmStore


def _request(key: str = "store-key-0001") -> SwarmCreateRequest:
    return SwarmCreateRequest(
        preset="forex_research_committee",
        title="Store test",
        objective="Bounded persistence test",
        idempotency_key=key,
    )


def _budgets() -> SwarmBudgets:
    return SwarmBudgets(
        token_budget=2_000,
        cost_budget=1,
        tool_call_budget=10,
        max_workers=2,
        max_tasks=10,
        max_depth=6,
        run_timeout_seconds=30,
        task_timeout_seconds=10,
        artifact_count=8,
        artifact_bytes=16_384,
        progress_event_count=100,
    )


async def _create(store: SwarmStore, key: str = "store-key-0001"):
    run_id = opaque_id("swr")
    tasks = build_tasks(
        get_preset("forex_research_committee"), run_id, max_attempts=2, task_timeout=10
    )
    return await store.create_or_get(
        _request(key),
        user_id=1,
        request_id="req-store",
        budgets=_budgets(),
        tasks=tasks,
        parameters={},
        max_attempts=2,
        timeout_seconds=30,
    )


@pytest.mark.asyncio
async def test_store_is_durable_tenant_scoped_and_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "work" / "swarm.sqlite3"
    store = SwarmStore(path, max_events=100)
    await store.initialize()
    run, created = await _create(store)
    assert created
    assert await store.get_for_user(run.swarm_run_id, 2) is None

    reopened = SwarmStore(path, max_events=100)
    await reopened.initialize()
    persisted = await reopened.get_for_user(run.swarm_run_id, 1)
    assert persisted is not None and persisted.status is SwarmRunStatus.QUEUED
    duplicate, duplicate_created = await reopened.create_or_get(
        _request(),
        user_id=1,
        request_id="req-store",
        budgets=_budgets(),
        tasks=await reopened.tasks_internal(run.swarm_run_id),
        parameters={},
        max_attempts=2,
        timeout_seconds=30,
    )
    assert not duplicate_created and duplicate.swarm_run_id == run.swarm_run_id


@pytest.mark.asyncio
async def test_store_rejects_illegal_transition_and_persists_output_first(tmp_path: Path) -> None:
    store = SwarmStore(tmp_path / "swarm.sqlite3", max_events=100)
    await store.initialize()
    run, _ = await _create(store, "store-key-0002")
    with pytest.raises(ServiceError, match="illegal"):
        await store.transition_run(run.swarm_run_id, SwarmRunStatus.SUCCEEDED, "run_completed")
    await store.transition_run(
        run.swarm_run_id, SwarmRunStatus.RUNNING, "run_started", started_at=run.created_at
    )
    task = (await store.tasks_internal(run.swarm_run_id))[0]
    await store.transition_task(run.swarm_run_id, task.task_id, SwarmTaskStatus.READY, "task_ready")
    await store.transition_task(
        run.swarm_run_id,
        task.task_id,
        SwarmTaskStatus.RUNNING,
        "task_started",
        attempt=1,
    )
    reference = run.evidence_refs
    output = GroundedTaskOutput(
        public_summary="insufficient",
        hypotheses=[
            GroundedClaim(
                claim_id="claim_none",
                statement="insufficient_evidence",
                status=ClaimStatus.INSUFFICIENT_EVIDENCE,
            )
        ],
        evidence_refs=reference,
    )
    completed = await store.complete_task(
        run.swarm_run_id, task.task_id, output, SwarmUsage(token_count=10)
    )
    assert completed.status is SwarmTaskStatus.SUCCEEDED
    assert task.task_id in await store.outputs_internal(run.swarm_run_id)
    assert (await store.usage_total(run.swarm_run_id)).token_count == 10


@pytest.mark.asyncio
async def test_startup_recovery_terminalizes_abandoned_runs(tmp_path: Path) -> None:
    store = SwarmStore(tmp_path / "swarm.sqlite3", max_events=100)
    await store.initialize()
    run, _ = await _create(store, "store-key-0003")
    await store.transition_run(
        run.swarm_run_id, SwarmRunStatus.RUNNING, "run_started", started_at=run.created_at
    )
    await store.recover_abandoned()
    recovered = await store.get_internal(run.swarm_run_id)
    assert recovered is not None
    assert recovered.status is SwarmRunStatus.FAILED
    assert recovered.error_code == "SWARM_SERVICE_RESTARTED"
    assert all(
        task.status in {SwarmTaskStatus.FAILED, SwarmTaskStatus.SUCCEEDED}
        for task in await store.tasks_internal(run.swarm_run_id)
    )


@pytest.mark.asyncio
async def test_progress_event_budget_is_bounded(tmp_path: Path) -> None:
    store = SwarmStore(tmp_path / "swarm.sqlite3", max_events=100)
    await store.initialize()
    budgets = _budgets().model_copy(update={"progress_event_count": 20})
    run_id = opaque_id("swr")
    request = _request("store-key-0004")
    tasks = build_tasks(get_preset(request.preset), run_id, max_attempts=2, task_timeout=10)
    run, _ = await store.create_or_get(
        request,
        user_id=1,
        request_id="req-store",
        budgets=budgets,
        tasks=tasks,
        parameters={},
        max_attempts=2,
        timeout_seconds=30,
    )
    for index in range(18):
        await store.append_event(run.swarm_run_id, "tool_called", metadata={"index": index})
    with pytest.raises(ServiceError, match="event budget"):
        await store.append_event(run.swarm_run_id, "tool_called")
