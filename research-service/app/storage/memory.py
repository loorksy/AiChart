from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Mapping
from typing import Any

from app.core.ids import opaque_id
from app.core.limits import MAX_ERROR_MESSAGE, MAX_PROGRESS_MESSAGE, MAX_PROGRESS_METADATA_BYTES
from app.core.redaction import bounded_metadata, redact_text
from app.errors import ServiceError
from app.models.jobs import (
    TERMINAL_STATES,
    ArtifactReference,
    JobCreateRequest,
    JobRecord,
    JobStatus,
    ProgressEvent,
    utc_now,
)

_TRANSITIONS: dict[JobStatus, set[JobStatus]] = {
    JobStatus.QUEUED: {JobStatus.RUNNING, JobStatus.CANCELLED, JobStatus.CANCELLING},
    JobStatus.RUNNING: {
        JobStatus.SUCCEEDED,
        JobStatus.FAILED,
        JobStatus.TIMED_OUT,
        JobStatus.CANCELLING,
        JobStatus.CANCELLED,
        JobStatus.RETRY_WAIT,
    },
    JobStatus.RETRY_WAIT: {JobStatus.RUNNING, JobStatus.CANCELLING, JobStatus.CANCELLED},
    JobStatus.CANCELLING: {JobStatus.CANCELLED},
    JobStatus.CANCELLED: set(),
    JobStatus.SUCCEEDED: set(),
    JobStatus.FAILED: set(),
    JobStatus.TIMED_OUT: set(),
}


def _fingerprint(request: JobCreateRequest) -> str:
    safe = request.model_dump(mode="json", exclude={"idempotency_key"})
    canonical = json.dumps(safe, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(canonical).hexdigest()


class InMemoryJobStore:
    """Development/test store. Process restart intentionally loses all state."""

    def __init__(self) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._events: dict[str, list[ProgressEvent]] = {}
        self._idempotency: dict[tuple[int, str], tuple[str, str]] = {}
        self._lock = asyncio.Lock()

    async def create_or_get(
        self, request: JobCreateRequest, timeout_seconds: int, max_attempts: int
    ) -> tuple[JobRecord, bool]:
        fingerprint = _fingerprint(request)
        key = (request.user_id, request.idempotency_key)
        async with self._lock:
            existing = self._idempotency.get(key)
            if existing:
                old_fingerprint, job_id = existing
                if old_fingerprint != fingerprint:
                    raise ServiceError(
                        "IDEMPOTENCY_CONFLICT", "idempotency key has a conflicting request", 409
                    )
                return self._jobs[job_id].model_copy(deep=True), False
            now = utc_now()
            job = JobRecord(
                job_id=opaque_id("rj"),
                job_type=request.job_type,
                user_id=request.user_id,
                request_id=request.request_id,
                idempotency_key=request.idempotency_key,
                timeout_seconds=timeout_seconds,
                max_attempts=max_attempts,
                created_at=now,
                queued_at=now,
                payload=request.payload,
            )
            self._jobs[job.job_id] = job
            self._events[job.job_id] = []
            self._idempotency[key] = (fingerprint, job.job_id)
            return job.model_copy(deep=True), True

    async def get_for_user(self, job_id: str, user_id: int) -> JobRecord | None:
        async with self._lock:
            job = self._jobs.get(job_id)
            return job.model_copy(deep=True) if job and job.user_id == user_id else None

    async def get_internal(self, job_id: str) -> JobRecord | None:
        async with self._lock:
            job = self._jobs.get(job_id)
            return job.model_copy(deep=True) if job else None

    async def delete(self, job_id: str) -> None:
        async with self._lock:
            job = self._jobs.pop(job_id, None)
            self._events.pop(job_id, None)
            if job:
                self._idempotency.pop((job.user_id, job.idempotency_key), None)

    async def transition(self, job_id: str, status: JobStatus, **updates: Any) -> JobRecord:
        async with self._lock:
            job = self._jobs[job_id]
            if status != job.status and status not in _TRANSITIONS[job.status]:
                raise ServiceError("JOB_FAILED", "illegal job state transition", 409)
            job.status = status
            for key, value in updates.items():
                if key == "error_message" and isinstance(value, str):
                    value = redact_text(value, MAX_ERROR_MESSAGE)
                if hasattr(job, key):
                    setattr(job, key, value)
            return job.model_copy(deep=True)

    async def request_cancel(self, job_id: str, user_id: int) -> JobRecord | None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job or job.user_id != user_id:
                return None
            if job.status in TERMINAL_STATES:
                return job.model_copy(deep=True)
            now = utc_now()
            if job.status == JobStatus.QUEUED:
                job.status = JobStatus.CANCELLED
                job.cancelled_at = now
                job.completed_at = now
            else:
                job.status = JobStatus.CANCELLING
            return job.model_copy(deep=True)

    async def append_progress(
        self,
        job_id: str,
        percent: int,
        stage: str,
        message: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> ProgressEvent:
        async with self._lock:
            job = self._jobs[job_id]
            safe_percent = max(job.progress_percent, min(100, percent))
            job.progress_percent = safe_percent
            job.progress_message = redact_text(message, MAX_PROGRESS_MESSAGE)
            events = self._events[job_id]
            event = ProgressEvent(
                sequence=len(events) + 1,
                job_id=job_id,
                user_id=job.user_id,
                timestamp=utc_now(),
                percent=safe_percent,
                stage=stage[:64],
                message=job.progress_message,
                metadata=bounded_metadata(metadata or {}, MAX_PROGRESS_METADATA_BYTES),
            )
            events.append(event)
            return event.model_copy(deep=True)

    async def events_for_user(self, job_id: str, user_id: int) -> list[ProgressEvent] | None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job or job.user_id != user_id:
                return None
            return [event.model_copy(deep=True) for event in self._events[job_id]]

    async def attach_artifact(self, job_id: str, artifact: ArtifactReference) -> None:
        async with self._lock:
            job = self._jobs[job_id]
            if job.user_id != artifact.user_id or artifact.job_id != job_id:
                raise ServiceError("JOB_UNAUTHORIZED", "resource not found", 404)
            job.artifact_refs.append(artifact)

    async def available(self) -> bool:
        return True
