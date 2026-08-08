from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Depends, Request

from app.security import require_internal_auth
from app.storage.models import StrategyListResponse
from app.storage.sqlite import SqliteQuantStore

router = APIRouter(prefix="/internal/quant-agent/strategies", tags=["quant-agent-strategies"])


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
