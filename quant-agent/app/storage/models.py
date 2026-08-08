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


class StrategyDef(BaseModel):
    strategy_id: str
    version: str
    display_name: str
    description: str
    enabled: bool = True
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


class GenerateValidateResponse(BaseModel):
    status: Literal["persisted", "invalid"]
    strategy: StrategyDef | None = None
    errors: list[dict[str, str]] = Field(default_factory=list)


class EnableStrategyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


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
    strategy_id: str
    version: str
    display_name: str
    description: str = ""
    regime_affinity: str
    code: str = Field(min_length=1, max_length=20_000)
