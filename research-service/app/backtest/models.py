from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class Side(StrEnum):
    LONG = "long"
    SHORT = "short"


class OrderType(StrEnum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"


class OrderStatus(StrEnum):
    PENDING = "pending"
    FILLED = "filled"
    PARTIALLY_FILLED = "partially_filled"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    REJECTED = "rejected"


class PositionStatus(StrEnum):
    OPEN = "open"
    PARTIALLY_CLOSED = "partially_closed"
    CLOSED = "closed"
    STOPPED = "stopped"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class IntrabarPolicy(StrEnum):
    WORST_CASE = "worst_case"
    BEST_CASE = "best_case"
    STOP_FIRST = "stop_first"
    TARGET_FIRST = "target_first"
    OHLC_PATH = "ohlc_path"
    REJECT_AMBIGUOUS = "reject_ambiguous"


class RunConfig(StrictModel):
    initial_capital: float = Field(gt=0, le=1_000_000_000)
    account_currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    leverage: float = Field(default=30, ge=1, le=500)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    intrabar_policy: IntrabarPolicy = IntrabarPolicy.WORST_CASE
    doji_path: str = Field(default="conservative", pattern=r"^(conservative|low_first|high_first)$")
    calendar_policy: str = Field(default="forex_weekend_only", pattern=r"^forex_weekend_only$")
    start_time: datetime | None = None
    end_time: datetime | None = None

    @model_validator(mode="after")
    def ordered_range(self) -> RunConfig:
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self


@dataclass(slots=True)
class Target:
    price: float
    size_fraction: float
    label: str
    filled_fraction: float = 0.0


@dataclass(slots=True)
class Order:
    order_id: str
    symbol: str
    side: Side
    order_type: OrderType
    created_index: int
    activation_index: int
    expiry_index: int
    reference_price: float
    requested_price: float | None
    size_lots: float
    stop_price: float
    target_prices: list[Target]
    signal_time: datetime
    status: OrderStatus = OrderStatus.PENDING
    fill_time: datetime | None = None
    fill_price: float | None = None
    cancellation_reason: str | None = None


@dataclass(slots=True)
class Position:
    position_id: str
    trade_id: str
    symbol: str
    side: Side
    entry_time: datetime
    entry_index: int
    entry_price: float
    reference_entry_price: float
    initial_size: float
    remaining_size: float
    initial_stop: float
    current_stop: float
    targets: list[Target]
    initial_risk_price: float
    entry_order_type: OrderType = OrderType.MARKET
    entry_requested_price: float | None = None
    status: PositionStatus = PositionStatus.OPEN
    realized_pnl: float = 0.0
    gross_pnl: float = 0.0
    spread_cost: float = 0.0
    slippage_cost: float = 0.0
    commission_cost: float = 0.0
    entry_spread_cost: float = 0.0
    entry_slippage_cost: float = 0.0
    entry_commission_cost: float = 0.0
    carry_cost: float = 0.0
    bars_held: int = 0
    break_even_active: bool = False
    pending_stop: float | None = None
    pending_exit_reason: str | None = None
    last_carry_date: str | None = None
    intrabar_ambiguous: bool = False
    events: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class Trade:
    trade_id: str
    symbol: str
    side: Side
    entry_time: datetime
    exit_time: datetime
    entry_price: float
    exit_price: float
    initial_size: float
    gross_pnl: float
    spread_cost: float
    slippage_cost: float
    commission_cost: float
    carry_cost: float
    net_pnl: float
    r_multiple: float | None
    holding_bars: int
    exit_reason: str
    session: str
    market_regime: str | None = None
    condition_set: str | None = None
    intrabar_ambiguous: bool = False
    intrabar_policy: str | None = None


@dataclass(slots=True)
class EquityPoint:
    timestamp: datetime
    balance: float
    equity: float
    drawdown: float
    exposure: float


@dataclass(slots=True)
class BacktestResult:
    strategy_hash: str
    dataset_hash: str
    engine_version: str
    indicator_version: str
    run_config: dict[str, Any]
    orders: list[Order]
    trades: list[Trade]
    equity: list[EquityPoint]
    events: list[dict[str, Any]]
    metrics: dict[str, Any]
    attribution: dict[str, Any]
    final_balance: float
