from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Depends, Header, Request

from app.errors import ServiceError
from app.security import CallerContext, require_caller
from app.swarm.manager import ResearchSwarmManager
from app.swarm.models import (
    SwarmArtifactsResponse,
    SwarmCreateRequest,
    SwarmCreateResponse,
    SwarmEventsResponse,
    SwarmRun,
    SwarmTask,
    SwarmTasksResponse,
)

router = APIRouter(prefix="/internal/research/swarms", tags=["research-swarms"])


def manager(request: Request) -> ResearchSwarmManager:
    return cast(ResearchSwarmManager, request.app.state.swarm_manager)


@router.post("", response_model=SwarmCreateResponse, status_code=202)
async def create_swarm(
    body: SwarmCreateRequest,
    context: CallerContext = Depends(require_caller),
    service: ResearchSwarmManager = Depends(manager),
    idempotency_header: str | None = Header(default=None, alias="X-AiChart-Idempotency-Key"),
) -> SwarmCreateResponse:
    if idempotency_header and idempotency_header != body.idempotency_key:
        raise ServiceError("SWARM_IDEMPOTENCY_CONFLICT", "idempotency header mismatch", 409)
    run, created = await service.create(body, context)
    return SwarmCreateResponse(run=run, created=created)


@router.get("/{run_id}", response_model=SwarmRun)
async def get_swarm(
    run_id: str,
    context: CallerContext = Depends(require_caller),
    service: ResearchSwarmManager = Depends(manager),
) -> SwarmRun:
    run = await service.store.get_for_user(run_id, context.user_id)
    if run is None:
        raise ServiceError("SWARM_NOT_FOUND", "research swarm run not found", 404)
    return run


@router.get("/{run_id}/tasks", response_model=SwarmTasksResponse)
async def get_swarm_tasks(
    run_id: str,
    context: CallerContext = Depends(require_caller),
    service: ResearchSwarmManager = Depends(manager),
) -> SwarmTasksResponse:
    tasks = await service.store.tasks_for_user(run_id, context.user_id)
    if tasks is None:
        raise ServiceError("SWARM_NOT_FOUND", "research swarm run not found", 404)
    return SwarmTasksResponse(tasks=tasks)


@router.get("/{run_id}/events", response_model=SwarmEventsResponse)
async def get_swarm_events(
    run_id: str,
    context: CallerContext = Depends(require_caller),
    service: ResearchSwarmManager = Depends(manager),
) -> SwarmEventsResponse:
    events = await service.store.events_for_user(run_id, context.user_id)
    if events is None:
        raise ServiceError("SWARM_NOT_FOUND", "research swarm run not found", 404)
    return SwarmEventsResponse(events=events)


@router.post("/{run_id}/cancel", response_model=SwarmRun)
async def cancel_swarm(
    run_id: str,
    context: CallerContext = Depends(require_caller),
    service: ResearchSwarmManager = Depends(manager),
) -> SwarmRun:
    return await service.cancel(run_id, context.user_id)


@router.post("/{run_id}/tasks/{task_id}/cancel", response_model=SwarmTask)
async def cancel_optional_swarm_task(
    run_id: str,
    task_id: str,
    context: CallerContext = Depends(require_caller),
    service: ResearchSwarmManager = Depends(manager),
) -> SwarmTask:
    return await service.cancel_optional_task(run_id, task_id, context.user_id)


@router.get("/{run_id}/artifacts", response_model=SwarmArtifactsResponse)
async def get_swarm_artifacts(
    run_id: str,
    context: CallerContext = Depends(require_caller),
    service: ResearchSwarmManager = Depends(manager),
) -> SwarmArtifactsResponse:
    return await service.artifacts_for_user(run_id, context.user_id)
