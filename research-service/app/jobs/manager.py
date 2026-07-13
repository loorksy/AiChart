from __future__ import annotations

import asyncio
import logging

from pydantic import BaseModel, ValidationError

from app.config import Settings
from app.core.redaction import contains_rejected_content
from app.errors import ServiceError
from app.jobs.cancellation import JobCancelled
from app.jobs.executor import execute_with_timeout
from app.jobs.payloads import (
    PHASE3_JOB_TYPES,
    RunBacktestValidationPayload,
    RunForexBacktestPayload,
    ValidateDatasetPayload,
    ValidateStrategySpecPayload,
)
from app.jobs.phase3 import normalize_phase3_failure
from app.jobs.tasks import RetryableTaskError
from app.logging import log_event
from app.models.jobs import (
    TERMINAL_STATES,
    ArtifactPayload,
    FailurePayload,
    JobCreateRequest,
    JobRecord,
    JobStatus,
    JobType,
    SmokePayload,
    utc_now,
)
from app.storage.artifacts import ArtifactStore
from app.storage.base import JobStore


class JobManager:
    def __init__(self, settings: Settings, store: JobStore, artifacts: ArtifactStore) -> None:
        self.settings = settings
        self.store = store
        self.artifacts = artifacts
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=settings.max_queued_jobs)
        self.workers: list[asyncio.Task[None]] = []
        self.cancel_events: dict[str, asyncio.Event] = {}
        self.started = False
        self.accepting = False

    async def start(self) -> None:
        await self.artifacts.initialize()
        self.accepting = True
        self.started = True
        self.workers = [
            asyncio.create_task(self._worker(index), name=f"research-worker-{index}")
            for index in range(self.settings.max_concurrent_jobs)
        ]

    async def stop(self) -> None:
        self.accepting = False
        for event in self.cancel_events.values():
            event.set()
        try:
            await asyncio.wait_for(self.queue.join(), timeout=2)
        except TimeoutError:
            pass
        for worker in self.workers:
            worker.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)
        self.workers.clear()
        self.started = False

    def _validated_payload(self, request: JobCreateRequest) -> dict[str, object]:
        if contains_rejected_content(request.payload):
            raise ServiceError("JOB_INPUT_INVALID", "unsafe payload content rejected", 422)
        model: type[BaseModel]
        if request.job_type == JobType.VALIDATE_STRATEGY_SPEC:
            model = ValidateStrategySpecPayload
        elif request.job_type == JobType.VALIDATE_DATASET:
            model = ValidateDatasetPayload
        elif request.job_type == JobType.RUN_FOREX_BACKTEST:
            model = RunForexBacktestPayload
        elif request.job_type == JobType.RUN_BACKTEST_VALIDATION:
            model = RunBacktestValidationPayload
        elif request.job_type == JobType.ARTIFACT_SMOKE_TEST:
            model = ArtifactPayload
        elif request.job_type == JobType.FAILURE_SMOKE_TEST:
            model = FailurePayload
        else:
            model = SmokePayload
        try:
            validated = model.model_validate(request.payload)
            mode = "json" if request.job_type.value in PHASE3_JOB_TYPES else "python"
            return validated.model_dump(mode=mode)
        except ValidationError as exc:
            raise ServiceError("JOB_INPUT_INVALID", "invalid job payload", 422) from exc

    async def create(self, request: JobCreateRequest) -> tuple[JobRecord, bool]:
        if not self.accepting:
            raise ServiceError("JOB_UNAVAILABLE", "job manager is not accepting work", 503)
        timeout = request.timeout_seconds or self.settings.default_timeout_seconds
        if timeout > self.settings.max_timeout_seconds:
            raise ServiceError("JOB_INPUT_INVALID", "timeout exceeds server maximum", 422)
        retries = request.max_retries if request.max_retries is not None else 0
        if request.job_type.value in PHASE3_JOB_TYPES and retries != 0:
            raise ServiceError("JOB_INPUT_INVALID", "Phase 3 research jobs cannot retry", 422)
        if retries > self.settings.max_retries:
            raise ServiceError("JOB_INPUT_INVALID", "retry count exceeds server maximum", 422)
        request = request.model_copy(update={"payload": self._validated_payload(request)})
        job, created = await self.store.create_or_get(request, timeout, retries + 1)
        if not created:
            return job, False
        try:
            self.queue.put_nowait(job.job_id)
        except asyncio.QueueFull as exc:
            await self.store.delete(job.job_id)
            raise ServiceError("JOB_QUEUE_FULL", "research job queue is full", 503) from exc
        await self.store.append_progress(job.job_id, 0, "queued", "job accepted")
        return (await self.store.get_internal(job.job_id)) or job, True

    async def cancel(self, job_id: str, user_id: int) -> JobRecord:
        job = await self.store.request_cancel(job_id, user_id)
        if job is None:
            raise ServiceError("JOB_NOT_FOUND", "research job not found", 404)
        if job.status in {JobStatus.CANCELLING, JobStatus.CANCELLED}:
            self.cancel_events.setdefault(job_id, asyncio.Event()).set()
            if job.status == JobStatus.CANCELLED:
                events = await self.store.events_for_user(job_id, user_id) or []
                if not events or events[-1].stage != "cancelled":
                    await self.store.append_progress(
                        job_id, job.progress_percent, "cancelled", "job cancelled"
                    )
        return (await self.store.get_for_user(job_id, user_id)) or job

    async def ready(self) -> bool:
        return (
            self.started
            and self.accepting
            and await self.store.available()
            and await self.artifacts.available()
        )

    async def _worker(self, _: int) -> None:
        while True:
            job_id = await self.queue.get()
            try:
                await self._run(job_id)
            except Exception as exc:  # worker containment boundary
                log_event(
                    logging.ERROR,
                    "worker containment failure",
                    job_id=job_id,
                    error_code="JOB_FAILED",
                )
                job = await self.store.get_internal(job_id)
                if job and job.status not in TERMINAL_STATES:
                    await self.store.transition(
                        job_id,
                        JobStatus.FAILED,
                        completed_at=utc_now(),
                        error_code="JOB_FAILED",
                        error_message=str(exc),
                    )
            finally:
                self.cancel_events.pop(job_id, None)
                self.queue.task_done()

    async def _run(self, job_id: str) -> None:
        job = await self.store.get_internal(job_id)
        if not job or job.status == JobStatus.CANCELLED:
            return
        cancelled = self.cancel_events.setdefault(job_id, asyncio.Event())
        while True:
            job = await self.store.get_internal(job_id)
            if not job or job.status in TERMINAL_STATES:
                return
            if cancelled.is_set():
                if job.status != JobStatus.CANCELLING:
                    await self.store.transition(job_id, JobStatus.CANCELLING)
                await self.store.append_progress(
                    job_id, job.progress_percent, "cancelled", "job cancelled"
                )
                await self.store.transition(
                    job_id,
                    JobStatus.CANCELLED,
                    cancelled_at=utc_now(),
                    completed_at=utc_now(),
                    error_code="JOB_CANCELLED",
                )
                return
            job = await self.store.transition(
                job_id,
                JobStatus.RUNNING,
                attempt=job.attempt + 1,
                started_at=job.started_at or utc_now(),
            )
            try:
                summary = await execute_with_timeout(job, self.store, self.artifacts, cancelled)
                await self.store.append_progress(job_id, 100, "succeeded", "job succeeded")
                await self.store.transition(
                    job_id,
                    JobStatus.SUCCEEDED,
                    completed_at=utc_now(),
                    result_summary=summary,
                )
                return
            except JobCancelled:
                await self.store.append_progress(
                    job_id, job.progress_percent, "cancelled", "job cancelled"
                )
                current = await self.store.get_internal(job_id)
                if current and current.status == JobStatus.RUNNING:
                    await self.store.transition(job_id, JobStatus.CANCELLING)
                await self.store.transition(
                    job_id,
                    JobStatus.CANCELLED,
                    cancelled_at=utc_now(),
                    completed_at=utc_now(),
                    error_code="JOB_CANCELLED",
                )
                return
            except TimeoutError:
                await self.store.append_progress(
                    job_id, job.progress_percent, "timed_out", "job timed out"
                )
                await self.store.transition(
                    job_id,
                    JobStatus.TIMED_OUT,
                    completed_at=utc_now(),
                    error_code="JOB_TIMEOUT",
                    error_message="job exceeded its approved timeout",
                )
                return
            except RetryableTaskError as exc:
                if job.attempt >= job.max_attempts:
                    await self._fail(job, "JOB_RETRY_EXHAUSTED", str(exc))
                    return
                await self.store.transition(
                    job_id,
                    JobStatus.RETRY_WAIT,
                    error_code="JOB_FAILED",
                    error_message="retryable task failure",
                )
                await self.store.append_progress(
                    job_id,
                    job.progress_percent,
                    "retry_wait",
                    "retry scheduled",
                    {"attempt": job.attempt},
                )
                await asyncio.sleep(0.01 * job.attempt)
            except Exception as exc:
                if job.job_type.value in PHASE3_JOB_TYPES:
                    code, message = normalize_phase3_failure(exc)
                    await self._fail(job, code, message)
                else:
                    await self._fail(job, "JOB_FAILED", str(exc))
                return

    async def _fail(self, job: JobRecord, code: str, message: str) -> None:
        await self.store.append_progress(job.job_id, job.progress_percent, "failed", "job failed")
        await self.store.transition(
            job.job_id,
            JobStatus.FAILED,
            completed_at=utc_now(),
            error_code=code,
            error_message=message,
        )
