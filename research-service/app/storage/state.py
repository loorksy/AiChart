from __future__ import annotations

import hashlib
import json

from app.models.jobs import JobCreateRequest, JobStatus

TRANSITIONS: dict[JobStatus, set[JobStatus]] = {
    JobStatus.QUEUED: {
        JobStatus.RUNNING,
        JobStatus.CANCELLED,
        JobStatus.CANCELLING,
        JobStatus.FAILED,
    },
    JobStatus.RUNNING: {
        JobStatus.SUCCEEDED,
        JobStatus.FAILED,
        JobStatus.TIMED_OUT,
        JobStatus.CANCELLING,
        JobStatus.CANCELLED,
        JobStatus.RETRY_WAIT,
    },
    JobStatus.RETRY_WAIT: {
        JobStatus.RUNNING,
        JobStatus.CANCELLING,
        JobStatus.CANCELLED,
        JobStatus.FAILED,
    },
    JobStatus.CANCELLING: {JobStatus.CANCELLED, JobStatus.FAILED},
    JobStatus.CANCELLED: set(),
    JobStatus.SUCCEEDED: set(),
    JobStatus.FAILED: set(),
    JobStatus.TIMED_OUT: set(),
}


def request_fingerprint(request: JobCreateRequest) -> str:
    safe = request.model_dump(mode="json", exclude={"idempotency_key"})
    canonical = json.dumps(safe, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(canonical).hexdigest()
