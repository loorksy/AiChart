from __future__ import annotations

from datetime import UTC, datetime
from typing import cast

from fastapi import APIRouter, Depends, Request
from pydantic import ValidationError

from app.engine.strategies.generated.schema import GeneratedStrategySpec
from app.engine.strategies.registry import registered_strategies
from app.errors import ServiceError
from app.security import require_internal_auth
from app.storage.models import (
    EnableStrategyRequest,
    GenerateValidateRequest,
    GenerateValidateResponse,
    StrategyDef,
    StrategyListResponse,
)
from app.storage.sqlite import SqliteQuantStore

router = APIRouter(prefix="/internal/quant-agent/strategies", tags=["quant-agent-strategies"])

_AUTH = Depends(require_internal_auth)
_HARDCODED_STRATEGY_IDS = frozenset(strategy.strategy_id for strategy in registered_strategies())


def _store(request: Request) -> SqliteQuantStore:
    return cast(SqliteQuantStore, request.app.state.store)


@router.get("", response_model=StrategyListResponse, dependencies=[Depends(require_internal_auth)])
async def list_strategies(store: SqliteQuantStore = Depends(_store)) -> StrategyListResponse:
    """Read-only registry introspection — enable/disable state lives in
    `quant_strategy_defs`, but flipping it does not remove a strategy from
    `engine/strategies/registry.py`'s in-process registry in this version;
    it is exposed for future admin tooling to act on."""
    strategies = await store.list_strategy_defs()
    return StrategyListResponse(strategies=strategies)


@router.post(
    "/generate-validate", response_model=GenerateValidateResponse, dependencies=[_AUTH]
)
async def generate_validate(
    body: GenerateValidateRequest, store: SqliteQuantStore = Depends(_store)
) -> GenerateValidateResponse:
    """Validate-and-persist only — this endpoint makes **no** outbound
    network or LLM call (`QUANT_AGENT_NETWORK_MODE=disabled` stays true).
    `web/` is expected to have already obtained `body.spec` from an LLM;
    this service just checks it against the closed `GeneratedStrategySpec`
    schema (fail-closed on any exception, never a 500) and, on success,
    stores it disabled (`enabled=False`) — `PATCH .../{strategy_id}` is the
    only path that makes a generated strategy live."""
    try:
        spec = GeneratedStrategySpec.model_validate(body.spec, strict=True)
    except ValidationError as exc:
        errors = [
            {"path": ".".join(str(part) for part in item["loc"]), "message": str(item["msg"])}
            for item in exc.errors(include_url=False, include_input=False)
        ]
        return GenerateValidateResponse(status="invalid", errors=errors)
    except Exception:  # noqa: BLE001 - fail-closed: any unexpected error is "invalid", never a 500
        return GenerateValidateResponse(
            status="invalid", errors=[{"path": "", "message": "spec could not be validated"}]
        )

    if spec.strategy_id in _HARDCODED_STRATEGY_IDS:
        return GenerateValidateResponse(
            status="invalid",
            errors=[
                {
                    "path": "strategy_id",
                    "message": "strategy_id collides with a built-in strategy",
                }
            ],
        )

    now = datetime.now(UTC).isoformat()
    strategy_def = StrategyDef(
        strategy_id=spec.strategy_id,
        version=spec.version,
        display_name=spec.display_name,
        description=spec.description,
        enabled=False,
        regime_affinity=spec.regime_affinity,
        source_generated=True,
        params_json=spec.model_dump_json(),
        created_at=now,
        updated_at=now,
    )
    persisted = await store.upsert_generated_strategy_def(strategy_def)
    if persisted is None:
        return GenerateValidateResponse(
            status="invalid",
            errors=[
                {
                    "path": "strategy_id",
                    "message": "strategy_id collides with an existing built-in strategy row",
                }
            ],
        )
    return GenerateValidateResponse(status="persisted", strategy=persisted)


@router.patch("/{strategy_id}", response_model=StrategyDef, dependencies=[_AUTH])
async def set_strategy_enabled(
    strategy_id: str,
    body: EnableStrategyRequest,
    store: SqliteQuantStore = Depends(_store),
) -> StrategyDef:
    """Only ever toggles `source_generated=True` rows — the hardcoded
    `ema_trend_v1`/`rsi_reversion_v1` rows are never reachable through this
    path (plan section 5)."""
    updated = await store.set_generated_strategy_enabled(strategy_id, body.enabled)
    if updated is None:
        raise ServiceError(
            "QUANT_AGENT_STRATEGY_NOT_FOUND",
            "no generated strategy with that id is enabled/disabled through this endpoint",
            404,
        )
    return updated
