from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.config import Settings, load_settings
from app.errors import ServiceError
from app.jobs.manager import JobManager
from app.models.jobs import JobCreateRequest, JobStatus, JobType, utc_now
from app.storage.artifacts import ArtifactStore
from app.storage.memory import InMemoryJobStore


def test_production_requires_a_strong_explicit_secret(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="required in production"):
        load_settings({"RESEARCH_SERVICE_ENV": "production"})
    with pytest.raises(ValueError, match="at least 32"):
        Settings(
            internal_token="too-short-for-production",
            environment="production",
            work_dir=tmp_path / "work",
            artifact_dir=tmp_path / "artifacts",
        )


async def test_graceful_shutdown_cancels_work_and_leaves_no_worker_tasks(
    tmp_path: Path,
) -> None:
    settings = Settings(
        internal_token="test-internal-token-with-32-characters",
        environment="test",
        work_dir=tmp_path / "work",
        artifact_dir=tmp_path / "artifacts",
        max_concurrent_jobs=1,
    )
    store = InMemoryJobStore()
    manager = JobManager(settings, store, ArtifactStore(settings.artifact_dir, 2048))
    await manager.start()
    request = JobCreateRequest(
        job_type=JobType.SERVICE_SMOKE_TEST,
        user_id=1,
        request_id="req-shutdown",
        idempotency_key="shutdown-key-001",
        payload={"duration_ms": 2000, "steps": 20},
    )
    job, _ = await manager.create(request)
    await asyncio.sleep(0.05)
    await manager.stop()
    assert manager.workers == []
    assert not manager.started
    stored = await store.get_for_user(job.job_id, 1)
    assert stored is not None
    assert stored.status.value == "cancelled"


async def test_queue_full_and_terminal_transition_are_enforced(tmp_path: Path) -> None:
    settings = Settings(
        internal_token="test-internal-token-with-32-characters",
        environment="test",
        work_dir=tmp_path / "work",
        artifact_dir=tmp_path / "artifacts",
        max_queued_jobs=1,
    )
    store = InMemoryJobStore()
    manager = JobManager(settings, store, ArtifactStore(settings.artifact_dir, 2048))
    await manager.artifacts.initialize()
    manager.accepting = True
    first = JobCreateRequest(
        job_type=JobType.SERVICE_SMOKE_TEST,
        user_id=1,
        request_id="req-queue-one",
        idempotency_key="queue-key-one-01",
        payload={"steps": 1},
    )
    second = first.model_copy(
        update={"request_id": "req-queue-two", "idempotency_key": "queue-key-two-02"}
    )
    job, _ = await manager.create(first)
    with pytest.raises(ServiceError) as queue_full:
        await manager.create(second)
    assert queue_full.value.code == "JOB_QUEUE_FULL"
    await store.transition(job.job_id, JobStatus.RUNNING, attempt=1)
    await store.transition(job.job_id, JobStatus.SUCCEEDED, completed_at=utc_now())
    with pytest.raises(ServiceError, match="illegal job state transition"):
        await store.transition(job.job_id, JobStatus.RUNNING)
