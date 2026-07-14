from __future__ import annotations

from pathlib import Path

from conftest import TOKEN, headers, job_body, wait_terminal
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models.jobs import (
    ArtifactReference,
    JobCreateRequest,
    JobStatus,
    JobType,
    utc_now,
)
from app.storage.sqlite import SqliteJobStore


async def test_sqlite_store_persists_tenant_state_events_and_artifacts(tmp_path: Path) -> None:
    path = tmp_path / "work" / "jobs.sqlite3"
    first = SqliteJobStore(path)
    await first.initialize()
    request = JobCreateRequest(
        job_type=JobType.SERVICE_SMOKE_TEST,
        user_id=7,
        request_id="req-durable",
        idempotency_key="durable-key-001",
        payload={"duration_ms": 1, "steps": 1},
    )
    job, created = await first.create_or_get(request, 3, 1)
    assert created
    await first.append_progress(job.job_id, 10, "running", "safe progress")
    await first.transition(job.job_id, JobStatus.RUNNING, attempt=1, started_at=utc_now())
    reference = ArtifactReference(
        artifact_id="ra_durable",
        job_id=job.job_id,
        user_id=7,
        artifact_type="json",
        name="result.json",
        relative_path=f"u-7/{job.job_id}/result.json",
        content_type="application/json",
        size_bytes=2,
        sha256="0" * 64,
        created_at=utc_now(),
    )
    await first.attach_artifact(job.job_id, reference)

    reopened = SqliteJobStore(path)
    await reopened.initialize()
    stored = await reopened.get_for_user(job.job_id, 7)
    assert stored is not None and stored.payload["steps"] == 1
    assert await reopened.get_for_user(job.job_id, 8) is None
    assert await reopened.get_artifact_for_user("ra_durable", job.job_id, 8) is None
    assert await reopened.get_artifact_for_user("ra_durable", job.job_id, 7) == reference
    events = await reopened.events_for_user(job.job_id, 7)
    assert events is not None and [event.sequence for event in events] == [1]

    assert await reopened.recover_pending() == []
    interrupted = await reopened.get_for_user(job.job_id, 7)
    assert interrupted is not None
    assert interrupted.status == JobStatus.FAILED
    assert interrupted.error_code == "JOB_SERVICE_RESTARTED"


async def test_sqlite_store_recovers_queued_jobs(tmp_path: Path) -> None:
    store = SqliteJobStore(tmp_path / "work" / "jobs.sqlite3")
    await store.initialize()
    request = JobCreateRequest(
        job_type=JobType.SERVICE_SMOKE_TEST,
        user_id=1,
        request_id="req-queued",
        idempotency_key="queued-key-001",
        payload={"duration_ms": 1, "steps": 1},
    )
    job, _ = await store.create_or_get(request, 3, 1)
    assert await SqliteJobStore(store.path).recover_pending() == [job.job_id]


def test_completed_job_and_artifact_survive_app_restart(tmp_path: Path) -> None:
    settings = Settings(
        internal_token=TOKEN,
        environment="production",
        job_storage="sqlite",
        work_dir=tmp_path / "work",
        artifact_dir=tmp_path / "artifacts",
        max_concurrent_jobs=1,
        max_queued_jobs=8,
        default_timeout_seconds=3,
        max_timeout_seconds=5,
        max_artifact_bytes=2048,
    )
    body = job_body(
        key="restart-artifact-001",
        job_type="artifact_smoke_test",
        payload={"duration_ms": 1, "steps": 1, "name": "restart.json"},
    )
    with TestClient(create_app(settings)) as first:
        response = first.post("/internal/research/jobs", headers=headers(), json=body)
        assert response.status_code == 202
        job = wait_terminal(first, response.json()["job"]["job_id"])
        assert job["status"] == "succeeded"
        reference = job["artifact_refs"][0]

    with TestClient(create_app(settings)) as reopened:
        stored = reopened.get(f"/internal/research/jobs/{job['job_id']}", headers=headers())
        assert stored.status_code == 200
        artifact = reopened.get(
            f"/internal/research/jobs/{job['job_id']}/artifacts/{reference['artifact_id']}",
            headers=headers(),
        )
        assert artifact.status_code == 200
        assert artifact.json()["sha256"] == reference["sha256"]
