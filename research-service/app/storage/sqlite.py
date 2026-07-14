from __future__ import annotations

import asyncio
import json
import os
import sqlite3
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path
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
from app.storage.state import TRANSITIONS, request_fingerprint


class SqliteJobStore:
    """Durable, tenant-scoped generic research job state."""

    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        self._lock = asyncio.Lock()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    async def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        async with self._lock:
            with self._connect() as connection:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS research_jobs (
                      job_id TEXT PRIMARY KEY,
                      user_id INTEGER NOT NULL,
                      idempotency_key TEXT NOT NULL,
                      fingerprint TEXT NOT NULL,
                      status TEXT NOT NULL,
                      queued_at TEXT NOT NULL,
                      record_json TEXT NOT NULL,
                      UNIQUE(user_id, idempotency_key)
                    );
                    CREATE INDEX IF NOT EXISTS idx_research_jobs_status_queued
                      ON research_jobs(status, queued_at);
                    CREATE INDEX IF NOT EXISTS idx_research_jobs_user_created
                      ON research_jobs(user_id, queued_at DESC);
                    CREATE TABLE IF NOT EXISTS research_job_events (
                      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                      job_id TEXT NOT NULL,
                      user_id INTEGER NOT NULL,
                      sequence INTEGER NOT NULL,
                      event_json TEXT NOT NULL,
                      UNIQUE(job_id, sequence),
                      FOREIGN KEY(job_id) REFERENCES research_jobs(job_id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_research_events_job_sequence
                      ON research_job_events(job_id, sequence);
                    """
                )
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    async def create_or_get(
        self, request: JobCreateRequest, timeout_seconds: int, max_attempts: int
    ) -> tuple[JobRecord, bool]:
        fingerprint = request_fingerprint(request)
        async with self._lock:
            with self._connect() as connection:
                existing = connection.execute(
                    """SELECT fingerprint,record_json FROM research_jobs
                    WHERE user_id=? AND idempotency_key=?""",
                    (request.user_id, request.idempotency_key),
                ).fetchone()
                if existing:
                    if existing["fingerprint"] != fingerprint:
                        raise ServiceError(
                            "IDEMPOTENCY_CONFLICT",
                            "idempotency key has a conflicting request",
                            409,
                        )
                    return self._job(existing["record_json"]), False
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
                connection.execute(
                    """INSERT INTO research_jobs
                    (job_id,user_id,idempotency_key,fingerprint,status,queued_at,record_json)
                    VALUES (?,?,?,?,?,?,?)""",
                    (
                        job.job_id,
                        job.user_id,
                        job.idempotency_key,
                        fingerprint,
                        job.status.value,
                        job.queued_at.isoformat(),
                        self._job_json(job),
                    ),
                )
                return job.model_copy(deep=True), True

    async def get_for_user(self, job_id: str, user_id: int) -> JobRecord | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT record_json FROM research_jobs WHERE job_id=? AND user_id=?",
                    (job_id, user_id),
                ).fetchone()
                return self._job(row["record_json"]) if row else None

    async def get_internal(self, job_id: str) -> JobRecord | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT record_json FROM research_jobs WHERE job_id=?", (job_id,)
                ).fetchone()
                return self._job(row["record_json"]) if row else None

    async def delete(self, job_id: str) -> None:
        async with self._lock:
            with self._connect() as connection:
                connection.execute("DELETE FROM research_jobs WHERE job_id=?", (job_id,))

    async def transition(self, job_id: str, status: JobStatus, **updates: Any) -> JobRecord:
        async with self._lock:
            with self._connect() as connection:
                job = self._required_job(connection, job_id)
                if status != job.status and status not in TRANSITIONS[job.status]:
                    raise ServiceError("JOB_FAILED", "illegal job state transition", 409)
                job.status = status
                for key, value in updates.items():
                    if key == "error_message" and isinstance(value, str):
                        value = redact_text(value, MAX_ERROR_MESSAGE)
                    if hasattr(job, key):
                        setattr(job, key, value)
                self._update(connection, job)
                return job.model_copy(deep=True)

    async def request_cancel(self, job_id: str, user_id: int) -> JobRecord | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT record_json FROM research_jobs WHERE job_id=? AND user_id=?",
                    (job_id, user_id),
                ).fetchone()
                if not row:
                    return None
                job = self._job(row["record_json"])
                if job.status in TERMINAL_STATES:
                    return job
                now = utc_now()
                if job.status == JobStatus.QUEUED:
                    job.status = JobStatus.CANCELLED
                    job.cancelled_at = now
                    job.completed_at = now
                else:
                    job.status = JobStatus.CANCELLING
                self._update(connection, job)
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
            with self._connect() as connection:
                job = self._required_job(connection, job_id)
                safe_percent = max(job.progress_percent, min(100, percent))
                job.progress_percent = safe_percent
                job.progress_message = redact_text(message, MAX_PROGRESS_MESSAGE)
                row = connection.execute(
                    """SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence
                    FROM research_job_events WHERE job_id=?""",
                    (job_id,),
                ).fetchone()
                event = ProgressEvent(
                    sequence=int(row["next_sequence"]),
                    job_id=job_id,
                    user_id=job.user_id,
                    timestamp=utc_now(),
                    percent=safe_percent,
                    stage=stage[:64],
                    message=job.progress_message,
                    metadata=bounded_metadata(metadata or {}, MAX_PROGRESS_METADATA_BYTES),
                )
                self._update(connection, job)
                connection.execute(
                    """INSERT INTO research_job_events(job_id,user_id,sequence,event_json)
                    VALUES (?,?,?,?)""",
                    (job_id, job.user_id, event.sequence, event.model_dump_json()),
                )
                return event.model_copy(deep=True)

    async def events_for_user(self, job_id: str, user_id: int) -> list[ProgressEvent] | None:
        async with self._lock:
            with self._connect() as connection:
                owner = connection.execute(
                    "SELECT 1 FROM research_jobs WHERE job_id=? AND user_id=?",
                    (job_id, user_id),
                ).fetchone()
                if not owner:
                    return None
                rows = connection.execute(
                    """SELECT event_json FROM research_job_events
                    WHERE job_id=? ORDER BY sequence""",
                    (job_id,),
                ).fetchall()
                return [ProgressEvent.model_validate_json(row["event_json"]) for row in rows]

    async def attach_artifact(self, job_id: str, artifact: ArtifactReference) -> None:
        async with self._lock:
            with self._connect() as connection:
                job = self._required_job(connection, job_id)
                if job.user_id != artifact.user_id or artifact.job_id != job_id:
                    raise ServiceError("JOB_UNAUTHORIZED", "resource not found", 404)
                job.artifact_refs.append(artifact)
                self._update(connection, job)

    async def get_artifact_for_user(
        self, artifact_id: str, job_id: str, user_id: int
    ) -> ArtifactReference | None:
        job = await self.get_for_user(job_id, user_id)
        if not job:
            return None
        item = next(
            (reference for reference in job.artifact_refs if reference.artifact_id == artifact_id),
            None,
        )
        return item.model_copy(deep=True) if item else None

    async def recover_pending(self) -> list[str]:
        """Return queued work and terminalize work interrupted by a process death."""
        async with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    """SELECT record_json FROM research_jobs
                    WHERE status IN (?,?,?,?) ORDER BY queued_at""",
                    (
                        JobStatus.QUEUED.value,
                        JobStatus.RUNNING.value,
                        JobStatus.RETRY_WAIT.value,
                        JobStatus.CANCELLING.value,
                    ),
                ).fetchall()
                queued: list[str] = []
                for row in rows:
                    job = self._job(row["record_json"])
                    if job.status == JobStatus.QUEUED:
                        queued.append(job.job_id)
                        continue
                    now = utc_now()
                    if job.status == JobStatus.CANCELLING:
                        job.status = JobStatus.CANCELLED
                        job.cancelled_at = now
                        job.error_code = "JOB_SERVICE_RESTARTED"
                        stage = "cancelled"
                    else:
                        job.status = JobStatus.FAILED
                        job.error_code = "JOB_SERVICE_RESTARTED"
                        job.error_message = "job was interrupted by a service restart"
                        stage = "failed"
                    job.completed_at = now
                    self._update(connection, job)
                    self._insert_recovery_event(connection, job, stage)
                return queued

    async def available(self) -> bool:
        try:
            async with self._lock:
                with self._connect() as connection:
                    connection.execute("SELECT 1").fetchone()
            return True
        except (OSError, sqlite3.Error):
            return False

    def _insert_recovery_event(
        self, connection: sqlite3.Connection, job: JobRecord, stage: str
    ) -> None:
        row = connection.execute(
            """SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence
            FROM research_job_events WHERE job_id=?""",
            (job.job_id,),
        ).fetchone()
        event = ProgressEvent(
            sequence=int(row["next_sequence"]),
            job_id=job.job_id,
            user_id=job.user_id,
            timestamp=utc_now(),
            percent=job.progress_percent,
            stage=stage,
            message="job interrupted by service restart",
            metadata={"error_code": "JOB_SERVICE_RESTARTED"},
        )
        connection.execute(
            """INSERT INTO research_job_events(job_id,user_id,sequence,event_json)
            VALUES (?,?,?,?)""",
            (job.job_id, job.user_id, event.sequence, event.model_dump_json()),
        )

    @staticmethod
    def _job_json(job: JobRecord) -> str:
        value = job.model_dump(mode="json")
        value["payload"] = job.payload
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))

    @staticmethod
    def _job(value: str) -> JobRecord:
        return JobRecord.model_validate_json(value)

    def _required_job(self, connection: sqlite3.Connection, job_id: str) -> JobRecord:
        row = connection.execute(
            "SELECT record_json FROM research_jobs WHERE job_id=?", (job_id,)
        ).fetchone()
        if not row:
            raise ServiceError("JOB_NOT_FOUND", "research job not found", 404)
        return self._job(row["record_json"])

    def _update(self, connection: sqlite3.Connection, job: JobRecord) -> None:
        connection.execute(
            "UPDATE research_jobs SET status=?,record_json=? WHERE job_id=?",
            (job.status.value, self._job_json(job), job.job_id),
        )
