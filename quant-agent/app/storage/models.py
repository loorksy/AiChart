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
