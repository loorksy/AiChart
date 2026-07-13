from __future__ import annotations

import asyncio
import json

from app.jobs.cancellation import JobCancelled
from app.jobs.payloads import PHASE3_JOB_TYPES
from app.jobs.phase3 import execute_phase3_task
from app.jobs.progress import ProgressReporter
from app.models.jobs import ArtifactPayload, FailurePayload, JobRecord, JobType, SmokePayload
from app.storage.artifacts import ArtifactStore
from app.storage.base import JobStore


class RetryableTaskError(Exception):
    pass


async def _steps(
    payload: SmokePayload, reporter: ProgressReporter, cancelled: asyncio.Event
) -> None:
    interval = payload.duration_ms / payload.steps / 1000
    for index in range(payload.steps):
        if cancelled.is_set():
            raise JobCancelled
        if interval:
            try:
                await asyncio.wait_for(cancelled.wait(), timeout=interval)
                raise JobCancelled
            except TimeoutError:
                pass
        await reporter.emit(
            int(((index + 1) / payload.steps) * 90),
            "processing",
            f"completed infrastructure step {index + 1}",
            {"step": index + 1, "total": payload.steps},
        )


async def execute_task(
    job: JobRecord,
    store: JobStore,
    artifacts: ArtifactStore,
    cancelled: asyncio.Event,
) -> str:
    reporter = ProgressReporter(store, job.job_id)
    if job.job_type.value in PHASE3_JOB_TYPES:
        await reporter.emit(1, "started", "research task started", {"attempt": job.attempt})
        return await execute_phase3_task(job, store, artifacts, cancelled)
    await reporter.emit(1, "started", "infrastructure task started", {"attempt": job.attempt})
    if job.job_type == JobType.FAILURE_SMOKE_TEST:
        failure_payload = FailurePayload.model_validate(job.payload)
        await _steps(failure_payload, reporter, cancelled)
        if job.attempt <= failure_payload.fail_attempts:
            if failure_payload.retryable:
                raise RetryableTaskError("intentional retryable smoke failure")
            raise RuntimeError("intentional smoke failure")
    elif job.job_type == JobType.ARTIFACT_SMOKE_TEST:
        artifact_payload = ArtifactPayload.model_validate(job.payload)
        await _steps(artifact_payload, reporter, cancelled)
        content = json.dumps(
            {"job_id": job.job_id, "status": "artifact_smoke_ok"},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        reference = await artifacts.write(
            job.user_id, job.job_id, "json", artifact_payload.name, content
        )
        await store.attach_artifact(job.job_id, reference)
        await reporter.emit(95, "artifact", "safe artifact reference created")
    else:
        smoke_payload = SmokePayload.model_validate(job.payload)
        await _steps(smoke_payload, reporter, cancelled)
    if cancelled.is_set():
        raise JobCancelled
    return "infrastructure smoke task completed"
