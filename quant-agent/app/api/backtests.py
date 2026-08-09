"""`POST /internal/quant-agent/strategies/{strategy_id}/backtest` -- the one
new endpoint this package's backtest engine (`app/engine/backtest/`) is
built for. Mirrors `app/api/strategies.py`'s shape: same internal-bearer
auth dependency, same fail-closed "never a 500 on bad input" style.

This endpoint only ever READS a `StrategyDef` (via
`app.engine.strategies.registry.strategy_from_def`, which deliberately does
NOT gate on `enabled` -- backtesting a not-yet-enabled candidate strategy is
the entire point) and WRITES to the new `quant_backtest_runs` table. It
never writes `quant_strategy_defs.enabled` from anywhere in this file."""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Depends, Request

from app.core.ids import opaque_id
from app.engine.backtest.run import run_backtest
from app.engine.strategies.base import Strategy
from app.engine.strategies.registry import strategy_by_id, strategy_from_def
from app.security import require_internal_auth
from app.storage.models import (
    BacktestCreateRequest,
    BacktestMetrics,
    BacktestResponse,
    BacktestRun,
    utc_now_iso,
)
from app.storage.sqlite import SqliteQuantStore

router = APIRouter(prefix="/internal/quant-agent/strategies", tags=["quant-agent-backtests"])

_AUTH = Depends(require_internal_auth)


def _store(request: Request) -> SqliteQuantStore:
    return cast(SqliteQuantStore, request.app.state.store)


async def _find_strategy(strategy_id: str, store: SqliteQuantStore) -> Strategy | None:
    """Hardcoded built-ins first, then `quant_strategy_defs` -- explicitly
    including an `enabled: false` row, unlike
    `registered_strategies_with_generated` (the live path's own lookup),
    which deliberately excludes disabled rows."""
    builtin = strategy_by_id(strategy_id)
    if builtin is not None:
        return builtin
    for definition in await store.list_strategy_defs():
        if definition.strategy_id == strategy_id:
            return strategy_from_def(definition)
    return None


@router.post("/{strategy_id}/backtest", response_model=BacktestResponse, dependencies=[_AUTH])
async def backtest_strategy(
    strategy_id: str,
    body: BacktestCreateRequest,
    request: Request,
    store: SqliteQuantStore = Depends(_store),
) -> BacktestResponse:
    settings = request.app.state.settings

    strategy = await _find_strategy(strategy_id, store)
    if strategy is None:
        return BacktestResponse(
            status="invalid", error=f"no strategy registered with id '{strategy_id}'"
        )

    if len(body.bars) < settings.min_bars:
        return BacktestResponse(
            status="invalid",
            error=f"at least {settings.min_bars} bars are required for reliable indicators",
        )
    if len(body.bars) > settings.backtest_max_bars:
        return BacktestResponse(
            status="invalid",
            error=f"at most {settings.backtest_max_bars} bars are accepted per backtest",
        )

    outcome = run_backtest(
        strategy,
        body.symbol,
        body.market,
        body.interval,
        body.bars,
        min_bars=settings.min_bars,
        batch_wall_clock_timeout_seconds=settings.backtest_batch_timeout_seconds,
        batch_per_bar_timeout_seconds=settings.backtest_per_bar_timeout_seconds,
    )
    metrics_payload = BacktestMetrics.model_validate(outcome.metrics.model_dump())

    warnings: list[str] = []
    unresolved = outcome.fired_count - len(outcome.trades)
    if unresolved > 0:
        warnings.append(
            f"{unresolved} fired signal(s) never resolved (neither stop nor target hit) "
            "before the bar series ended and were excluded from the metrics"
        )

    run = BacktestRun(
        id=opaque_id("qbt"),
        strategy_id=strategy.strategy_id,
        strategy_version=strategy.version,
        symbol=body.symbol,
        market=body.market,
        interval=body.interval,
        bar_count=len(body.bars),
        from_time=body.bars[0].time,
        to_time=body.bars[-1].time,
        status="completed",
        metrics=metrics_payload,
        warnings=warnings,
        created_at=utc_now_iso(),
    )
    await store.create_backtest_run(run)

    return BacktestResponse(
        status="completed", metrics=metrics_payload, warnings=warnings or None
    )
