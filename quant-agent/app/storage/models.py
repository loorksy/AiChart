from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Direction = Literal["buy", "sell"]
PlanType = Literal["immediate", "anticipatory", "conditional"]
LifecycleState = Literal["active", "expired", "invalidated", "superseded"]


def utc_now() -> datetime:
    return datetime.now(UTC)


def utc_now_iso() -> str:
    return utc_now().isoformat()


class Bar(BaseModel):
    """One OHLC(V) candle, pushed in by the caller. No field is ever fetched
    by this service — see app/config.py `network_mode` and the module
    docstring in app/__init__.py."""

    model_config = ConfigDict(extra="forbid")
    time: str = Field(min_length=1, max_length=64)
    open: float
    high: float
    low: float
    close: float
    volume: float | None = Field(default=None, ge=0)

    @field_validator("open", "high", "low", "close")
    @classmethod
    def _finite(cls, value: float) -> float:
        if value != value or value in (float("inf"), float("-inf")):  # noqa: PLR0124 (NaN check)
            raise ValueError("price fields must be finite numbers")
        return value

    @model_validator(mode="after")
    def _consistent_range(self) -> Bar:
        top = max(self.open, self.close)
        bottom = min(self.open, self.close)
        if self.high < top or self.low > bottom or self.high < self.low:
            raise ValueError("bar high/low must bound open/close")
        return self

    @field_validator("time")
    @classmethod
    def _parseable_time(cls, value: str) -> str:
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("bar time must be ISO-8601") from exc
        return value


class RecommendationCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str = Field(min_length=1, max_length=32)
    market: str = Field(default="forex", min_length=1, max_length=32)
    interval: str = Field(min_length=1, max_length=16)
    bars: list[Bar] = Field(min_length=2, max_length=5000)
    owner_user_id: int = Field(gt=0)
    request_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")

    @model_validator(mode="after")
    def _bars_strictly_ascending(self) -> RecommendationCreateRequest:
        parsed = [datetime.fromisoformat(bar.time.replace("Z", "+00:00")) for bar in self.bars]
        for previous, current in zip(parsed, parsed[1:], strict=False):
            if current <= previous:
                raise ValueError("bars must be strictly ascending by time with no duplicates")
        return self


class Recommendation(BaseModel):
    id: str
    owner_user_id: int
    symbol: str
    market: str
    interval: str
    direction: Direction
    plan_type: PlanType
    entry: float | None
    stop_loss: float
    take_profit: float | None
    targets: list[float] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    strategy_id: str
    strategy_version: str
    regime: str | None = None
    rationale: str
    evidence: dict[str, Any] = Field(default_factory=dict)
    validity_expires_at: str | None = None
    lifecycle_state: LifecycleState = "active"
    source_bar_close_time: str
    idempotency_key: str
    created_at: str
    updated_at: str


class RecommendationEvent(BaseModel):
    event_id: int
    recommendation_id: str
    owner_user_id: int
    sequence: int
    event_type: str
    detail: dict[str, Any] = Field(default_factory=dict)
    created_at: str


StrategyStatus = Literal["ready", "needs_work", "active", "paused", "archived"]


class StrategyDef(BaseModel):
    strategy_id: str
    version: str
    display_name: str
    description: str
    #: The executable switch the registry reads. DERIVED from `status` and
    #: written in the same statement by `set_strategy_status`, never on its
    #: own — two independently-writable switches is how a paused strategy
    #: keeps trading.
    enabled: bool = True
    #: The user-facing lifecycle.
    #:
    #: `ready`      backtested, cleared the quality gate, awaiting the owner
    #: `needs_work` backtested, missed the gate; the owner may still activate
    #: `active`     evaluated on the owner's scans (signals only, never orders)
    #: `paused`     the owner turned it off
    #: `archived`   soft-deleted; never loaded again
    status: StrategyStatus = "ready"
    #: Who owns it. NULL is a platform built-in: loaded for every user, and
    #: modifiable by none of them.
    owner_user_id: int | None = None
    regime_affinity: str | None = None
    source_generated: bool = False
    params_json: str | None = None
    # "declarative": params_json holds a GeneratedStrategySpec (data only).
    # "sandboxed_code": source_code holds AI-generated Python, executed only
    # via app.sandbox.safe_exec + app.engine.strategies.generated_code.
    generation_mode: Literal["declarative", "sandboxed_code"] = "declarative"
    source_code: str | None = None
    created_at: str
    updated_at: str


class NoSignalResponse(BaseModel):
    status: Literal["no_signal"] = "no_signal"
    symbol: str
    market: str
    interval: str
    regime: str | None
    rationale: str
    source_bar_close_time: str


class RecommendationCreateResponse(BaseModel):
    status: Literal["created", "deduplicated", "no_signal"]
    recommendation: Recommendation | None = None
    no_signal: NoSignalResponse | None = None


class RecommendationListResponse(BaseModel):
    recommendations: list[Recommendation]


class StrategyListResponse(BaseModel):
    strategies: list[StrategyDef]


class HealthResponse(BaseModel):
    status: str
    service: str = "aichart-quant-agent"
    version: str = "0.1.0"


class GenerateValidateRequest(BaseModel):
    """Body for `POST /internal/quant-agent/strategies/generate-validate`.

    `web/` obtains `spec` from an LLM elsewhere and posts it here; this
    service makes no outbound network/LLM call of its own — it only
    validates the already-generated spec against
    `app.engine.strategies.generated.schema.GeneratedStrategySpec` and, on
    success, persists it (plan section 5)."""

    model_config = ConfigDict(extra="forbid")
    spec: dict[str, Any]
    #: Who this strategy will belong to. Without it a generated strategy has
    #: no owner, and an ownerless row is either everybody's (unsafe) or
    #: nobody's (useless) — so it is required at the moment of creation
    #: rather than patched on afterwards.
    owner_user_id: int = Field(gt=0)



class GenerateValidateResponse(BaseModel):
    status: Literal["persisted", "invalid"]
    strategy: StrategyDef | None = None
    errors: list[dict[str, str]] = Field(default_factory=list)


class SetStrategyStatusRequest(BaseModel):
    """A lifecycle transition, requested by the strategy's owner.

    `owner_user_id` is mandatory and is checked against the stored row before
    anything is written — the caller asserting who they are is not the same as
    the row agreeing, and the store is where that gets settled.
    """

    model_config = ConfigDict(extra="forbid")
    status: StrategyStatus
    owner_user_id: int = Field(gt=0)


class BacktestMetrics(BaseModel):
    """Wire/persisted shape of `app.engine.backtest.models.BacktestMetrics`.

    Deliberately a separate, duplicated definition rather than an import of
    the engine type: `app.engine.features` already imports `Bar` from this
    module, so importing anything from `app.engine.*` back into
    `app/storage/models.py` would create a circular import at module load
    time. This mirrors the existing `Signal` -> `Recommendation` pattern
    (`app/engine/planner.py`) of an engine-local type being copied,
    field-for-field, into its storage/wire counterpart."""

    trade_count: int
    win_rate: float | None = None
    profit_factor: float | None = None
    expectancy_r: float | None = None
    max_drawdown_r: float | None = None
    max_drawdown_percent: float | None = None
    sharpe_r: float | None = None
    metric_reasons: dict[str, str] = Field(default_factory=dict)


class BacktestRun(BaseModel):
    """One persisted `quant_backtest_runs` row."""

    id: str
    strategy_id: str
    strategy_version: str
    symbol: str
    market: str
    interval: str
    bar_count: int
    from_time: str
    to_time: str
    status: Literal["completed", "invalid"]
    metrics: BacktestMetrics | None = None
    warnings: list[str] = Field(default_factory=list)
    created_at: str


class BacktestCreateRequest(BaseModel):
    """Body for `POST /internal/quant-agent/strategies/{strategy_id}/backtest`.

    Same shape/conventions as `RecommendationCreateRequest`, with a much
    higher `bars` ceiling — a backtest replays a whole historical window
    (the plan's own default is 5000 bars), not a single live decision."""

    model_config = ConfigDict(extra="forbid")
    bars: list[Bar] = Field(min_length=2, max_length=20_000)
    symbol: str = Field(min_length=1, max_length=32)
    market: str = Field(default="forex", min_length=1, max_length=32)
    interval: str = Field(min_length=1, max_length=16)
    owner_user_id: int = Field(gt=0)
    request_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")

    @model_validator(mode="after")
    def _bars_strictly_ascending(self) -> BacktestCreateRequest:
        parsed = [datetime.fromisoformat(bar.time.replace("Z", "+00:00")) for bar in self.bars]
        for previous, current in zip(parsed, parsed[1:], strict=False):
            if current <= previous:
                raise ValueError("bars must be strictly ascending by time with no duplicates")
        return self


class BacktestResponse(BaseModel):
    """`status="invalid"` is reserved for genuinely malformed input (strategy
    not found, too few/too many bars) — a zero-trade result is
    `status="completed"`, never an error."""

    status: Literal["completed", "invalid"]
    metrics: BacktestMetrics | None = None
    warnings: list[str] | None = None
    error: str | None = None


class GenerateValidateCodeRequest(BaseModel):
    """Body for `POST /internal/quant-agent/strategies/generate-validate-code`.

    `web/` obtains `code` from an LLM elsewhere and posts it here; this
    service makes no outbound network/LLM call of its own — it only runs the
    code through `app.sandbox.safe_exec.validate_code_safety` and the
    compile/discovery step in
    `app.engine.strategies.generated_code.contract`, and on success persists
    it disabled."""

    model_config = ConfigDict(extra="forbid")
    #: Who this strategy will belong to. Without it a generated strategy has
    #: no owner, and an ownerless row is either everybody's (unsafe) or
    #: nobody's (useless) — so it is required at the moment of creation
    #: rather than patched on afterwards.
    owner_user_id: int = Field(gt=0)
    strategy_id: str
    version: str
    display_name: str
    description: str = ""
    regime_affinity: str
    code: str = Field(min_length=1, max_length=20_000)


# ---------------------------------------------------------------------------
# Automated bots (grid / DCA / martingale / layered martingale)
#
# `execution_mode` on a saved bot is the owner's per-bot arming switch
# (`simulation` | `live`). The engine under `app/engine/bots/` still only
# replays bars through `SimulatedQuantBroker` — live orders are placed by the
# web platform via createIntent → executeIntent, never from this service.
#
# Shapes derived from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
# Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
# (http://www.apache.org/licenses/LICENSE-2.0) —
# `backend_api_python/app/services/strategy_runtime/executors.py` (the executor
# config vocabulary and preview envelope), `.../app/services/grid/
# resting_orders_repo.py` and `.../app/services/live_trading/grid_cells.py`.
# ---------------------------------------------------------------------------

BotType = Literal["grid", "dca", "martingale", "layered_martingale"]

#: Per-bot arming switch. `live` means the owner has authorised this bot to
#: create intents on the web side; it does NOT mean this service talks to a
#: venue — the engine stays simulation-only.
BotExecutionMode = Literal["simulation", "live"]


class BotDefinition(BaseModel):
    """One persisted `quant_bots` row — a saved bot configuration."""

    id: str
    owner_user_id: int
    bot_type: BotType
    name: str
    symbol: str
    market: str = "forex"
    interval: str
    execution_mode: BotExecutionMode = "simulation"
    initial_capital: float
    fee_rate: float
    config: dict[str, Any] = Field(default_factory=dict)
    levels: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    risk_diagnostics: list[dict[str, Any]] = Field(default_factory=list)
    created_at: str
    updated_at: str


class BotRun(BaseModel):
    """One persisted `quant_bot_runs` row — a completed simulation."""

    id: str
    bot_id: str
    owner_user_id: int
    execution_mode: BotExecutionMode = "simulation"
    status: Literal["completed", "invalid"]
    bar_count: int = 0
    from_time: str = ""
    to_time: str = ""
    cells_bootstrapped: int = 0
    orders_placed: int = 0
    fill_count: int = 0
    matched_cycles: int = 0
    realized_profit: float = 0.0
    unrealized_profit: float = 0.0
    total_commission: float = 0.0
    ending_price: float = 0.0
    resting_orders: int = 0
    stop_reason: str = ""
    warnings: list[str] = Field(default_factory=list)
    logs: list[dict[str, str]] = Field(default_factory=list)
    cells: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None
    created_at: str


class BotFill(BaseModel):
    """One persisted `quant_bot_fills` row — one simulated crossing."""

    id: int = 0
    run_id: str
    owner_user_id: int
    sequence: int
    bar_time: str
    cell_index: int
    purpose: str
    price: float
    quantity: float


class BotLedgerEntry(BaseModel):
    """One persisted `quant_bot_ledger` row — one trade the fill produced.

    `grid_matched_profit` is populated only on exits, and when it is, it is the
    cell's own two-rung PnL rather than the FIFO answer. That override is
    upstream's deliberate rule; see `app/engine/bots/fill_handler.py`.
    """

    id: int = 0
    run_id: str
    owner_user_id: int
    sequence: int
    trade_type: str
    close_reason: str = ""
    cell_index: int = -1
    price: float
    amount: float
    commission: float = 0.0
    profit: float | None = None
    matched_entry_price: float | None = None
    grid_matched_profit: float | None = None


class BotPreviewRequest(BaseModel):
    """Body for `POST /internal/quant-agent/bots/preview`. Pure: nothing is
    stored and nothing is executed — a ladder of levels comes back."""

    model_config = ConfigDict(extra="forbid")
    bot_type: BotType = "grid"
    config: dict[str, Any] = Field(default_factory=dict)


class BotPreviewResponse(BaseModel):
    execution_mode: BotExecutionMode = "simulation"
    status: Literal["ok", "invalid"]
    bot_type: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    levels: list[dict[str, Any]] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    risk_diagnostics: list[dict[str, Any]] = Field(default_factory=list)
    blocking_warning: str = ""
    error: str | None = None


class BotCreateRequest(BaseModel):
    """Body for `POST /internal/quant-agent/bots`."""

    model_config = ConfigDict(extra="forbid")
    owner_user_id: int = Field(gt=0)
    bot_type: BotType = "grid"
    name: str = Field(min_length=1, max_length=80)
    symbol: str = Field(min_length=1, max_length=32)
    market: str = Field(default="forex", min_length=1, max_length=32)
    interval: str = Field(min_length=1, max_length=16)
    initial_capital: float = Field(default=1000.0, ge=0, le=1_000_000)
    fee_rate: float = Field(default=0.001, ge=0, le=0.05)
    config: dict[str, Any] = Field(default_factory=dict)


class BotExecutionModeRequest(BaseModel):
    """Body for `PATCH /internal/quant-agent/bots/{bot_id}/execution-mode`."""

    model_config = ConfigDict(extra="forbid")
    owner_user_id: int = Field(gt=0)
    execution_mode: BotExecutionMode


class BotListResponse(BaseModel):
    execution_mode: BotExecutionMode = "simulation"
    bots: list[BotDefinition] = Field(default_factory=list)


class BotSimulateRequest(BaseModel):
    """Body for `POST /internal/quant-agent/bots/{bot_id}/simulate`.

    `owner_user_id` is mandatory and is checked against the stored bot before
    anything runs: an id in the path is never authority on its own.
    """

    model_config = ConfigDict(extra="forbid")
    owner_user_id: int = Field(gt=0)
    bars: list[Bar] = Field(min_length=1, max_length=20_000)

    @model_validator(mode="after")
    def _bars_strictly_ascending(self) -> BotSimulateRequest:
        parsed = [datetime.fromisoformat(bar.time.replace("Z", "+00:00")) for bar in self.bars]
        for previous, current in zip(parsed, parsed[1:], strict=False):
            if current <= previous:
                raise ValueError("bars must be strictly ascending by time with no duplicates")
        return self


class BotSimulateResponse(BaseModel):
    execution_mode: BotExecutionMode = "simulation"
    status: Literal["completed", "invalid"]
    run: BotRun | None = None
    fills: list[BotFill] = Field(default_factory=list)
    ledger: list[BotLedgerEntry] = Field(default_factory=list)
    error: str | None = None


class BotRunListResponse(BaseModel):
    execution_mode: BotExecutionMode = "simulation"
    runs: list[BotRun] = Field(default_factory=list)
