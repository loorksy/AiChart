from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Depends, Query, Request

from app.engine.combine import combine_signals
from app.engine.features import compute_features
from app.engine.planner import build_no_signal_response, build_recommendation
from app.engine.strategies.registry import registered_strategies_with_generated
from app.errors import ServiceError, require
from app.security import require_internal_auth
from app.storage.models import (
    Recommendation,
    RecommendationCreateRequest,
    RecommendationCreateResponse,
    RecommendationListResponse,
)
from app.storage.sqlite import SqliteQuantStore

router = APIRouter(
    prefix="/internal/quant-agent/recommendations", tags=["quant-agent-recommendations"]
)

_AUTH = Depends(require_internal_auth)


def _store(request: Request) -> SqliteQuantStore:
    return cast(SqliteQuantStore, request.app.state.store)


@router.post("", response_model=RecommendationCreateResponse, dependencies=[_AUTH])
async def create_recommendation(
    body: RecommendationCreateRequest,
    request: Request,
    store: SqliteQuantStore = Depends(_store),
) -> RecommendationCreateResponse:
    settings = request.app.state.settings
    require(
        len(body.bars) >= settings.min_bars,
        "QUANT_AGENT_INSUFFICIENT_BARS",
        f"at least {settings.min_bars} bars are required for reliable indicators",
        422,
    )
    require(
        len(body.bars) <= settings.max_bars,
        "QUANT_AGENT_INPUT_INVALID",
        f"at most {settings.max_bars} bars are accepted per request",
        422,
    )

    features = compute_features(body.symbol, body.market, body.interval, body.bars)
    strategies = await registered_strategies_with_generated(store)
    signals = [strategy.evaluate(features) for strategy in strategies]
    combine_result = combine_signals(signals, features.regime)

    recommendation = build_recommendation(
        features=features,
        combine_result=combine_result,
        owner_user_id=body.owner_user_id,
        validity_bars=settings.validity_bars,
    )
    if recommendation is None:
        return RecommendationCreateResponse(
            status="no_signal",
            no_signal=build_no_signal_response(features, combine_result),
        )

    stored, created = await store.create_recommendation(recommendation)
    return RecommendationCreateResponse(
        status="created" if created else "deduplicated", recommendation=stored
    )


@router.get("", response_model=RecommendationListResponse, dependencies=[_AUTH])
async def list_recommendations(
    symbol: str | None = Query(default=None, max_length=32),
    state: str | None = Query(default=None, max_length=32, alias="state"),
    owner_user_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=50, ge=1, le=500),
    store: SqliteQuantStore = Depends(_store),
) -> RecommendationListResponse:
    recommendations = await store.list_recommendations(
        symbol=symbol, lifecycle_state=state, owner_user_id=owner_user_id, limit=limit
    )
    return RecommendationListResponse(recommendations=recommendations)


@router.get("/{recommendation_id}", response_model=Recommendation, dependencies=[_AUTH])
async def get_recommendation(
    recommendation_id: str,
    store: SqliteQuantStore = Depends(_store),
) -> Recommendation:
    recommendation = await store.get(recommendation_id)
    if recommendation is None:
        raise ServiceError("QUANT_AGENT_NOT_FOUND", "recommendation not found", 404)
    return recommendation
