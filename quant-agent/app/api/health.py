from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.security import require_internal_auth
from app.storage.models import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health/live", response_model=HealthResponse)
async def live() -> HealthResponse:
    return HealthResponse(status="live")


@router.get("/health/ready", dependencies=[Depends(require_internal_auth)])
async def ready(request: Request) -> JSONResponse:
    settings = request.app.state.settings
    store = request.app.state.store
    db_ready = await store.available()
    body = {
        "status": "ready" if db_ready else "not_ready",
        "service": "aichart-quant-agent",
        "version": "0.1.0",
        "storage": "durable" if settings.durable_storage else "volatile",
        "network_mode": settings.network_mode,
    }
    return JSONResponse(body, status_code=200 if db_ready else 503)
