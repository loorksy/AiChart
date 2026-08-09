"""The automated-bot endpoints — preview a ladder, save a bot, replay it.

SIMULATION ONLY. There is no endpoint here that starts a bot, submits an order
or connects an account, because there is nothing in this service that could
honour such a call: the engine's only broker is `SimulatedQuantBroker`. Every
response carries `execution_mode: "simulation"` so a caller cannot mistake a
replay for a deployment, and the field is a `Literal` of one value in
`app/storage/models.py`, so widening it would be a type error everywhere it is
read.

Ownership is checked on EVERY by-id handler. `owner_user_id` travels in the
body (not the path) and the store has no unscoped `get_bot`, so a handler
physically cannot look a bot up without saying whose it is. A bot belonging to
someone else is a 404, never a 403 — distinguishing the two leaks which ids
exist.

Error convention follows `app/api/factors.py`: a data endpoint, so a request
that cannot be served is a coded 4xx rather than a 200 carrying
`status="invalid"`. The one exception is `/preview`, which mirrors
`app/api/strategies.py` and returns a 200 with `status="invalid"` — a preview's
whole job is to explain why a config is wrong while the user is still typing it,
and an HTTP error is a worse place to put that explanation than the body.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger), Copyright
Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Upstream sources:
`backend_api_python/app/routes/strategy_grid_routes.py` and the executor
preview/deploy routes in `.../app/routes/strategy.py`. Changed on port: the
deploy verbs (`/start`, `/stop`, credential binding, `execution_mode: "live"`)
are not carried across at all, and `POST .../simulate` — which has no upstream
counterpart, because upstream runs its grid against a real venue — takes their
place.
"""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Depends, Query, Request

from app.core.ids import opaque_id
from app.engine.bots.config import GridBotConfig
from app.engine.bots.ladders import (
    grid_bot_params_from_executor_config,
    preview_executor,
)
from app.engine.bots.simulated_broker import (
    GridSimulationResult,
    SimulatedBar,
    SymbolSpec,
    run_grid_simulation,
)
from app.errors import ServiceError, require
from app.security import require_internal_auth
from app.storage.models import (
    BotCreateRequest,
    BotDefinition,
    BotFill,
    BotLedgerEntry,
    BotListResponse,
    BotPreviewRequest,
    BotPreviewResponse,
    BotRun,
    BotRunListResponse,
    BotSimulateRequest,
    BotSimulateResponse,
    utc_now_iso,
)
from app.storage.sqlite import SqliteQuantStore

router = APIRouter(prefix="/internal/quant-agent/bots", tags=["quant-agent-bots"])

_AUTH = Depends(require_internal_auth)

#: Upstream's own error codes, surfaced with one line of English each so an
#: operator reading a log does not have to open `ladders.py` to decode them.
_CONFIG_ERROR_MESSAGES: dict[str, str] = {
    "GRID_COUNT_EXCEEDS_SAFE_LIMIT": "grid_count is above the 200-cell safety limit",
    "NEUTRAL_GRID_REQUIRES_SWAP": "a neutral grid needs both legs, which a spot market cannot hold",
}


def _store(request: Request) -> SqliteQuantStore:
    return cast(SqliteQuantStore, request.app.state.store)


def _config_error(exc: ValueError) -> str:
    raw = str(exc)
    if raw.startswith("unsupported_executor_type:"):
        return f"{raw}: only grid, dca, martingale and layered_martingale have engines"
    detail = _CONFIG_ERROR_MESSAGES.get(raw)
    return f"{raw}: {detail}" if detail else raw


def _preview(bot_type: str, config: dict[str, object]) -> BotPreviewResponse:
    try:
        preview = preview_executor({**config, "executor_type": bot_type})
    except ValueError as exc:
        return BotPreviewResponse(status="invalid", bot_type=bot_type, error=_config_error(exc))
    payload = preview.to_dict()
    return BotPreviewResponse(
        status="ok",
        bot_type=str(payload["executor_type"]),
        config=cast(dict[str, object], payload["config"]),
        levels=cast(list[dict[str, object]], payload["levels"]),
        summary=cast(dict[str, object], payload["summary"]),
        warnings=cast(list[str], payload["warnings"]),
        risk_diagnostics=cast(list[dict[str, object]], payload["risk_diagnostics"]),
        blocking_warning=preview.blocking_warning,
    )


@router.post("/preview", response_model=BotPreviewResponse, dependencies=[_AUTH])
async def preview_bot(body: BotPreviewRequest) -> BotPreviewResponse:
    """The ladder a config would produce, plus every warning it earns.

    Pure: nothing is stored, nothing is simulated, nothing is executed. This is
    what the config form calls on every keystroke.
    """
    return _preview(body.bot_type, dict(body.config))


@router.post("", response_model=BotDefinition, dependencies=[_AUTH])
async def create_bot(
    body: BotCreateRequest,
    store: SqliteQuantStore = Depends(_store),
) -> BotDefinition:
    """Save a bot configuration. Saving is NOT starting: nothing runs until a
    caller posts bars to `/simulate`, and even then it runs against those bars
    and nothing else."""
    preview = _preview(body.bot_type, dict(body.config))
    if preview.status == "invalid":
        raise ServiceError(
            "QUANT_AGENT_INPUT_INVALID", preview.error or "bot config is invalid", 422
        )
    require(
        not preview.blocking_warning,
        "QUANT_AGENT_INPUT_INVALID",
        f"INVALID_EXECUTOR_CONFIG:{preview.blocking_warning}",
        422,
    )
    now = utc_now_iso()
    bot = BotDefinition(
        id=opaque_id("qbot"),
        owner_user_id=body.owner_user_id,
        bot_type=body.bot_type,
        name=body.name.strip(),
        symbol=body.symbol.strip(),
        market=body.market.strip(),
        interval=body.interval.strip(),
        execution_mode="simulation",
        initial_capital=body.initial_capital,
        fee_rate=body.fee_rate,
        config=preview.config,
        levels=preview.levels,
        warnings=preview.warnings,
        risk_diagnostics=preview.risk_diagnostics,
        created_at=now,
        updated_at=now,
    )
    return await store.create_bot(bot)


@router.get("", response_model=BotListResponse, dependencies=[_AUTH])
async def list_bots(
    owner_user_id: int = Query(gt=0),
    limit: int = Query(default=50, ge=1, le=200),
    store: SqliteQuantStore = Depends(_store),
) -> BotListResponse:
    return BotListResponse(bots=await store.list_bots(owner_user_id, limit=limit))


@router.get("/{bot_id}", response_model=BotDefinition, dependencies=[_AUTH])
async def get_bot(
    bot_id: str,
    owner_user_id: int = Query(gt=0),
    store: SqliteQuantStore = Depends(_store),
) -> BotDefinition:
    bot = await store.get_bot(owner_user_id, bot_id)
    if bot is None:
        raise ServiceError("QUANT_AGENT_NOT_FOUND", "bot not found", 404)
    return bot


@router.delete("/{bot_id}", dependencies=[_AUTH])
async def delete_bot(
    bot_id: str,
    owner_user_id: int = Query(gt=0),
    store: SqliteQuantStore = Depends(_store),
) -> dict[str, bool]:
    if not await store.delete_bot(owner_user_id, bot_id):
        raise ServiceError("QUANT_AGENT_NOT_FOUND", "bot not found", 404)
    return {"ok": True}


@router.get("/{bot_id}/runs", response_model=BotRunListResponse, dependencies=[_AUTH])
async def list_bot_runs(
    bot_id: str,
    owner_user_id: int = Query(gt=0),
    limit: int = Query(default=20, ge=1, le=100),
    store: SqliteQuantStore = Depends(_store),
) -> BotRunListResponse:
    bot = await store.get_bot(owner_user_id, bot_id)
    if bot is None:
        raise ServiceError("QUANT_AGENT_NOT_FOUND", "bot not found", 404)
    return BotRunListResponse(runs=await store.list_bot_runs(owner_user_id, bot_id, limit=limit))


def _run_from_result(
    bot: BotDefinition, result: GridSimulationResult, bars: list[SimulatedBar]
) -> BotRun:
    return BotRun(
        id=opaque_id("qbrun"),
        bot_id=bot.id,
        owner_user_id=bot.owner_user_id,
        execution_mode="simulation",
        status="completed" if result.ok else "invalid",
        bar_count=result.bar_count,
        from_time=bars[0].time if bars else "",
        to_time=bars[-1].time if bars else "",
        cells_bootstrapped=result.cells_bootstrapped,
        orders_placed=result.orders_placed,
        fill_count=result.fill_count,
        matched_cycles=result.matched_cycles,
        realized_profit=result.realized_profit,
        unrealized_profit=result.unrealized_profit,
        total_commission=result.total_commission,
        ending_price=result.ending_price,
        resting_orders=result.resting_orders,
        stop_reason=result.stop_reason,
        warnings=result.warnings,
        logs=result.logs,
        cells=result.cells,
        error=result.error or None,
        created_at=utc_now_iso(),
    )


@router.post("/{bot_id}/simulate", response_model=BotSimulateResponse, dependencies=[_AUTH])
async def simulate_bot(
    bot_id: str,
    body: BotSimulateRequest,
    store: SqliteQuantStore = Depends(_store),
) -> BotSimulateResponse:
    """Replay a saved bot over pushed-in bars.

    Ownership is resolved before anything else runs, through the only accessor
    the store offers — one that takes an owner. Only grid bots have a runtime
    engine to replay: DCA and both martingales are ladder generators upstream
    expresses as generated strategy source, which this service does not host,
    so they preview and save but do not simulate. Saying so is better than
    pretending a ladder is a run.
    """
    bot = await store.get_bot(body.owner_user_id, bot_id)
    if bot is None:
        raise ServiceError("QUANT_AGENT_NOT_FOUND", "bot not found", 404)
    require(
        bot.bot_type == "grid",
        "QUANT_AGENT_INPUT_INVALID",
        f"{bot.bot_type} has a level ladder but no replay engine; only grid bots simulate",
        422,
    )

    cfg = GridBotConfig.from_trading_config(
        {
            "market_type": str(bot.config.get("market_type") or "swap"),
            "leverage": bot.config.get("leverage", 1),
            "bot_params": grid_bot_params_from_executor_config(
                bot.config, trade_direction=str(bot.config.get("side") or "long")
            ),
        }
    )
    bars = [
        SimulatedBar(time=bar.time, open=bar.open, high=bar.high, low=bar.low, close=bar.close)
        for bar in body.bars
    ]
    result = run_grid_simulation(
        strategy_id=abs(hash(bot.id)) % 10_000,
        cfg=cfg,
        bars=bars,
        initial_capital=bot.initial_capital,
        fee_rate=bot.fee_rate,
        spec=SymbolSpec(),
    )
    run = _run_from_result(bot, result, bars)
    if not result.ok:
        # A rejected config still gets a persisted run: "we tried and the
        # spacing did not clear fees" is history worth keeping.
        await store.create_bot_run(run, [], [])
        return BotSimulateResponse(status="invalid", run=run, error=result.error)

    fills = [
        BotFill(
            run_id=run.id,
            owner_user_id=bot.owner_user_id,
            sequence=index + 1,
            bar_time=str(fill.get("bar_time") or ""),
            cell_index=int(fill.get("cell_index") or -1),
            purpose=str(fill.get("purpose") or ""),
            price=float(fill.get("price") or 0.0),
            quantity=float(fill.get("quantity") or 0.0),
        )
        for index, fill in enumerate(result.fills)
    ]
    ledger = [
        BotLedgerEntry(
            run_id=run.id,
            owner_user_id=bot.owner_user_id,
            sequence=int(trade.get("sequence") or index + 1),
            trade_type=str(trade.get("trade_type") or ""),
            close_reason=str(trade.get("close_reason") or ""),
            cell_index=int(trade.get("cell_index") or -1),
            price=float(trade.get("price") or 0.0),
            amount=float(trade.get("amount") or 0.0),
            commission=float(trade.get("commission") or 0.0),
            profit=cast(float | None, trade.get("profit")),
            matched_entry_price=cast(float | None, trade.get("matched_entry_price")),
            grid_matched_profit=cast(float | None, trade.get("grid_matched_profit")),
        )
        for index, trade in enumerate(result.trades)
    ]
    await store.create_bot_run(run, fills, ledger)
    return BotSimulateResponse(status="completed", run=run, fills=fills, ledger=ledger)
