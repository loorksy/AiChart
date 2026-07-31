from __future__ import annotations

from typing import Any, cast

from fastapi import APIRouter, Depends, Header, Request

from app.errors import ServiceError
from app.jobs.manager import JobManager
from app.models.api import EventsResponse, JobCreateResponse
from app.models.jobs import ArtifactReference, JobCreateRequest, JobRecord
from app.security import CallerContext, require_caller
from app.services.artifacts import JobArtifactService

router = APIRouter(prefix="/internal/research/jobs", tags=["research-jobs"])


def manager(request: Request) -> JobManager:
    return cast(JobManager, request.app.state.manager)


@router.post("", response_model=JobCreateResponse, status_code=202)
async def create_job(
    body: JobCreateRequest,
    context: CallerContext = Depends(require_caller),
    service: JobManager = Depends(manager),
    idempotency_header: str | None = Header(default=None, alias="X-AiChart-Idempotency-Key"),
) -> JobCreateResponse:
    if body.user_id != context.user_id or body.request_id != context.request_id:
        raise ServiceError("JOB_UNAUTHORIZED", "tenant context mismatch", 404)
    if idempotency_header and idempotency_header != body.idempotency_key:
        raise ServiceError("IDEMPOTENCY_CONFLICT", "idempotency header mismatch", 409)
    job, created = await service.create(body)
    return JobCreateResponse(job=job, created=created)


@router.get("/{job_id}", response_model=JobRecord)
async def get_job(
    job_id: str,
    context: CallerContext = Depends(require_caller),
    service: JobManager = Depends(manager),
) -> JobRecord:
    job = await service.store.get_for_user(job_id, context.user_id)
    if job is None:
        raise ServiceError("JOB_NOT_FOUND", "research job not found", 404)
    return job


@router.get("/{job_id}/events", response_model=EventsResponse)
async def get_events(
    job_id: str,
    context: CallerContext = Depends(require_caller),
    service: JobManager = Depends(manager),
) -> EventsResponse:
    events = await service.store.events_for_user(job_id, context.user_id)
    if events is None:
        raise ServiceError("JOB_NOT_FOUND", "research job not found", 404)
    return EventsResponse(events=events)


@router.post("/{job_id}/cancel", response_model=JobRecord)
async def cancel_job(
    job_id: str,
    context: CallerContext = Depends(require_caller),
    service: JobManager = Depends(manager),
) -> JobRecord:
    return await service.cancel(job_id, context.user_id)


@router.get("/{job_id}/artifacts/{artifact_id}", response_model=ArtifactReference)
async def get_artifact(
    job_id: str,
    artifact_id: str,
    context: CallerContext = Depends(require_caller),
    service: JobManager = Depends(manager),
) -> ArtifactReference:
    item = await service.store.get_artifact_for_user(artifact_id, job_id, context.user_id)
    if item is None:
        item = await service.artifacts.get_for_user(artifact_id, job_id, context.user_id)
    if item is None:
        raise ServiceError("JOB_NOT_FOUND", "research artifact not found", 404)
    return item


@router.get("/{job_id}/artifacts/{artifact_id}/content")
async def get_json_artifact_content(
    job_id: str,
    artifact_id: str,
    context: CallerContext = Depends(require_caller),
    service: JobManager = Depends(manager),
) -> dict[str, Any]:
    """Tenant-scoped, integrity-checked JSON artifact content for web orchestration."""
    job = await service.store.get_for_user(job_id, context.user_id)
    if job is None:
        raise ServiceError("JOB_NOT_FOUND", "research job not found", 404)
    reader = JobArtifactService(service.artifacts, service.store)
    return await reader.read_json_object(
        user_id=context.user_id,
        source_job_id=job_id,
        artifact_id=artifact_id,
        max_bytes=2 * 1024 * 1024,
    )


@router.get("/{job_id}/artifacts/{artifact_id}/csv")
async def get_csv_artifact_rows(
    job_id: str,
    artifact_id: str,
    context: CallerContext = Depends(require_caller),
    service: JobManager = Depends(manager),
) -> dict[str, Any]:
    """Bounded CSV artifact rows (equity curve, trade list) for web visualization."""
    job = await service.store.get_for_user(job_id, context.user_id)
    if job is None:
        raise ServiceError("JOB_NOT_FOUND", "research job not found", 404)
    reader = JobArtifactService(service.artifacts, service.store)
    rows = await reader.read_csv_rows(
        user_id=context.user_id,
        source_job_id=job_id,
        artifact_id=artifact_id,
        required_fields=frozenset(),
        max_bytes=8 * 1024 * 1024,
        max_rows=50_000,
    )
    return {"rows": rows}
