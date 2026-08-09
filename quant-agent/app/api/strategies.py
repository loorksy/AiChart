from __future__ import annotations

from datetime import UTC, datetime
from typing import cast

from fastapi import APIRouter, Depends, Request
from pydantic import ValidationError

from app.engine.strategies.generated.schema import GeneratedStrategySpec
from app.engine.strategies.generated_code.contract import compile_and_discover
from app.engine.strategies.registry import registered_strategies
from app.errors import ServiceError
from app.security import require_internal_auth
from app.storage.models import (
    GenerateValidateCodeRequest,
    GenerateValidateRequest,
    GenerateValidateResponse,
    SetStrategyStatusRequest,
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
        # A freshly generated strategy is never live. It becomes `active`
        # only after a backtest clears the quality gate, or after its owner
        # activates it deliberately having seen the failing numbers.
        enabled=False,
        status="ready",
        owner_user_id=body.owner_user_id,
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


@router.post(
    "/generate-validate-code", response_model=GenerateValidateResponse, dependencies=[_AUTH]
)
async def generate_validate_code(
    body: GenerateValidateCodeRequest, store: SqliteQuantStore = Depends(_store)
) -> GenerateValidateResponse:
    """Sandboxed-code sibling of `/generate-validate`. Same guarantees:
    makes **no** outbound network or LLM call (`web/` already obtained
    `body.code` from an LLM), never a 500 on bad input, always persists
    `enabled=False`. The extra step here is `compile_and_discover`, which
    actually runs `body.code` once -- inside an isolated subprocess, never
    in-process -- against a neutral stub before it is ever stored."""
    if body.strategy_id in _HARDCODED_STRATEGY_IDS:
        return GenerateValidateResponse(
            status="invalid",
            errors=[
                {
                    "path": "strategy_id",
                    "message": "strategy_id collides with a built-in strategy",
                }
            ],
        )

    try:
        ok, error = compile_and_discover(body.code)
    except Exception:  # noqa: BLE001 - fail-closed: any unexpected error is "invalid", never a 500
        ok, error = False, "code could not be validated"
    if not ok:
        message = error or "unsafe or invalid code"
        errors = [{"path": "code", "message": message}]
        return GenerateValidateResponse(status="invalid", errors=errors)

    now = datetime.now(UTC).isoformat()
    strategy_def = StrategyDef(
        strategy_id=body.strategy_id,
        version=body.version,
        display_name=body.display_name,
        description=body.description,
        # A freshly generated strategy is never live. It becomes `active`
        # only after a backtest clears the quality gate, or after its owner
        # activates it deliberately having seen the failing numbers.
        enabled=False,
        status="ready",
        owner_user_id=body.owner_user_id,
        regime_affinity=body.regime_affinity,
        source_generated=True,
        generation_mode="sandboxed_code",
        source_code=body.code,
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
async def set_strategy_status(
    strategy_id: str,
    body: SetStrategyStatusRequest,
    store: SqliteQuantStore = Depends(_store),
) -> StrategyDef:
    """Move one of the CALLER'S OWN generated strategies through its lifecycle.

    Built-ins are unreachable here, and so is anybody else's row: the store
    checks ownership and returns `None` for every refusal, which becomes the
    same 404. That is deliberate — distinguishing "no such strategy" from "not
    yours" tells a prober which ids exist.

    Ownership is what replaced the admin-only stopgap. That restriction existed
    because the registry loaded every enabled generated strategy for every
    user, so an owner enabling their own put their code in strangers'
    recommendations. Now the registry is scoped per owner, and enabling your
    own strategy affects exactly your own signals."""
    updated = await store.set_strategy_status(strategy_id, body.status, body.owner_user_id)
    if updated is None:
        raise ServiceError(
            "QUANT_AGENT_STRATEGY_NOT_FOUND",
            "no generated strategy with that id belongs to this owner",
            404,
        )
    return updated
