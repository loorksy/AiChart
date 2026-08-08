from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from app import __version__
from app.api.backtests import router as backtests_router
from app.api.health import router as health_router
from app.api.recommendations import router as recommendations_router
from app.api.strategies import router as strategies_router
from app.config import Settings, load_settings
from app.engine.strategies.registry import registered_strategies
from app.errors import error_body, install_error_handlers
from app.logging import configure_logging
from app.storage.models import StrategyDef
from app.storage.sqlite import SqliteQuantStore


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or load_settings()
    configure_logging(resolved.log_level)
    assert resolved.db_path is not None
    store = SqliteQuantStore(resolved.db_path)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        resolved.work_dir.mkdir(parents=True, exist_ok=True)
        await store.initialize()
        now = datetime.now(UTC).isoformat()
        await store.seed_strategy_defs(
            [
                StrategyDef(
                    strategy_id=strategy.strategy_id,
                    version=strategy.version,
                    display_name=strategy.display_name,
                    description=strategy.description,
                    enabled=True,
                    regime_affinity=strategy.regime_affinity,
                    created_at=now,
                    updated_at=now,
                )
                for strategy in registered_strategies()
            ]
        )
        yield

    app = FastAPI(
        title="AiChart Quant Agent",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.settings = resolved
    app.state.store = store

    @app.middleware("http")
    async def request_size_limit(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > resolved.max_request_bytes:
            return JSONResponse(
                error_body("QUANT_AGENT_INPUT_INVALID", "request exceeds size limit"),
                status_code=413,
            )
        body = await request.body()
        if len(body) > resolved.max_request_bytes:
            return JSONResponse(
                error_body("QUANT_AGENT_INPUT_INVALID", "request exceeds size limit"),
                status_code=413,
            )
        return await call_next(request)

    install_error_handlers(app)
    app.include_router(health_router)
    app.include_router(recommendations_router)
    app.include_router(strategies_router)
    app.include_router(backtests_router)
    return app


app = create_app()
