from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.models.api import HealthResponse
from app.security import require_internal_auth

router = APIRouter(tags=["health"])


@router.get("/health/live", response_model=HealthResponse)
async def live() -> HealthResponse:
    return HealthResponse(status="live")


@router.get("/health/ready", dependencies=[Depends(require_internal_auth)])
async def ready(request: Request) -> JSONResponse:
    manager_ready = await request.app.state.manager.ready()
    settings = request.app.state.settings
    swarm_ready = not settings.swarm_enabled or await request.app.state.swarm_manager.ready()
    production_storage_ready = settings.environment != "production" or settings.durable_storage
    is_ready = manager_ready and swarm_ready and production_storage_ready
    body = {
        "status": "ready" if is_ready else "not_ready",
        "service": "aichart-research",
        "version": "0.1.0",
        "storage": "durable" if settings.durable_storage else "volatile",
        "research_swarm": (
            "disabled" if not settings.swarm_enabled else "ready" if swarm_ready else "not_ready"
        ),
    }
    return JSONResponse(body, status_code=200 if is_ready else 503)
