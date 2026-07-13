from __future__ import annotations

import json
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(UTC)


class JobType(StrEnum):
    SERVICE_SMOKE_TEST = "service_smoke_test"
    ARTIFACT_SMOKE_TEST = "artifact_smoke_test"
    FAILURE_SMOKE_TEST = "failure_smoke_test"
    TIMEOUT_SMOKE_TEST = "timeout_smoke_test"
    VALIDATE_STRATEGY_SPEC = "validate_strategy_spec"
    VALIDATE_DATASET = "validate_dataset"
    RUN_FOREX_BACKTEST = "run_forex_backtest"
    RUN_BACKTEST_VALIDATION = "run_backtest_validation"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    RETRY_WAIT = "retry_wait"


TERMINAL_STATES = {
    JobStatus.CANCELLED,
    JobStatus.SUCCEEDED,
    JobStatus.FAILED,
    JobStatus.TIMED_OUT,
}


class SmokePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    duration_ms: int = Field(default=100, ge=0, le=30_000)
    steps: int = Field(default=3, ge=1, le=100)


class ArtifactPayload(SmokePayload):
    name: str = Field(default="smoke-result.json", min_length=1, max_length=100)


class FailurePayload(SmokePayload):
    retryable: bool = False
    fail_attempts: int = Field(default=1, ge=1, le=5)


Payload = Annotated[
    SmokePayload | ArtifactPayload | FailurePayload, Field(union_mode="left_to_right")
]


class JobCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_type: JobType
    user_id: int = Field(gt=0)
    request_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    idempotency_key: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    timeout_seconds: int | None = Field(default=None, ge=1, le=3600)
    max_retries: int | None = Field(default=None, ge=0, le=5)
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def payload_size(self) -> JobCreateRequest:
        try:
            encoded = json.dumps(
                self.payload,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            ).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise ValueError("payload must be JSON-compatible") from exc
        phase3_types = {
            JobType.VALIDATE_STRATEGY_SPEC,
            JobType.VALIDATE_DATASET,
            JobType.RUN_FOREX_BACKTEST,
            JobType.RUN_BACKTEST_VALIDATION,
        }
        maximum = 8 * 1024 * 1024 if self.job_type in phase3_types else 8192
        if len(encoded) > maximum:
            raise ValueError("payload is too large")
        return self


class ProgressEvent(BaseModel):
    sequence: int
    job_id: str
    user_id: int
    timestamp: datetime
    percent: int = Field(ge=0, le=100)
    stage: str
    message: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ArtifactReference(BaseModel):
    artifact_id: str
    job_id: str
    user_id: int
    artifact_type: Literal["text", "json", "csv"]
    name: str
    relative_path: str
    content_type: str
    size_bytes: int
    sha256: str
    created_at: datetime


class JobRecord(BaseModel):
    model_config = ConfigDict(validate_assignment=True)
    job_id: str
    job_type: JobType
    user_id: int
    request_id: str
    idempotency_key: str
    status: JobStatus = JobStatus.QUEUED
    progress_percent: int = 0
    progress_message: str = "queued"
    attempt: int = 0
    max_attempts: int = 1
    timeout_seconds: int
    created_at: datetime
    queued_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    error_code: str | None = None
    error_message: str | None = None
    artifact_refs: list[ArtifactReference] = Field(default_factory=list)
    result_summary: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict, exclude=True)
