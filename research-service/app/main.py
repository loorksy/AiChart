from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from app import __version__
from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.api.swarms import router as swarms_router
from app.config import Settings, load_settings
from app.errors import error_body, install_error_handlers
from app.jobs.manager import JobManager
from app.logging import configure_logging
from app.storage.artifacts import ArtifactStore
from app.storage.memory import InMemoryJobStore
from app.storage.sqlite import SqliteJobStore
from app.swarm.manager import ResearchSwarmManager
from app.swarm.store import SwarmStore


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or load_settings()
    configure_logging(resolved.log_level)
    assert resolved.job_storage is not None
    assert resolved.job_db_path is not None
    store = (
        SqliteJobStore(resolved.job_db_path)
        if resolved.job_storage == "sqlite"
        else InMemoryJobStore()
    )
    artifacts = ArtifactStore(resolved.artifact_dir, resolved.max_artifact_bytes)
    manager = JobManager(resolved, store, artifacts)
    assert resolved.swarm_db_path is not None
    swarm_store = SwarmStore(resolved.swarm_db_path, max_events=resolved.swarm_progress_event_count)
    swarm_manager = ResearchSwarmManager(resolved, swarm_store, artifacts)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        resolved.work_dir.mkdir(parents=True, exist_ok=True)
        await manager.start()
        await swarm_manager.start()
        try:
            yield
        finally:
            await swarm_manager.stop()
            await manager.stop()

    app = FastAPI(
        title="AiChart Research Service",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.settings = resolved
    app.state.manager = manager
    app.state.swarm_manager = swarm_manager

    @app.middleware("http")
    async def request_size_limit(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > resolved.max_request_bytes:
            return JSONResponse(
                error_body("JOB_INPUT_INVALID", "request exceeds size limit"), status_code=413
            )
        body = await request.body()
        if len(body) > resolved.max_request_bytes:
            return JSONResponse(
                error_body("JOB_INPUT_INVALID", "request exceeds size limit"), status_code=413
            )
        return await call_next(request)

    install_error_handlers(app)
    app.include_router(health_router)
    app.include_router(jobs_router)
    app.include_router(swarms_router)
    return app


app = create_app()
