from __future__ import annotations

import re
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from .models import (
    SYMBOL_REGISTRY,
    Direction,
    FrozenStrictModel,
    Market,
    Timeframe,
)

SPEC_VERSION: Literal["1.0.0"] = "1.0.0"


class ComparisonOperator(StrEnum):
    ABOVE = "above"
    BELOW = "below"
    EQUAL = "equal"
    CROSSES_ABOVE = "crosses_above"
    CROSSES_BELOW = "crosses_below"


class PriceField(StrEnum):
    OPEN = "open"
    HIGH = "high"
    LOW = "low"
    CLOSE = "close"


class PriceReference(StrEnum):
    OPEN = "open"
    HIGH = "high"
    LOW = "low"
    CLOSE = "close"
    PREVIOUS_OPEN = "previous_open"
    PREVIOUS_HIGH = "previous_high"
    PREVIOUS_LOW = "previous_low"
    PREVIOUS_CLOSE = "previous_close"


class PriceComparisonCondition(FrozenStrictModel):
    type: Literal["price_comparison"]
    timeframe: Timeframe
    left: PriceField
    operator: ComparisonOperator
    right_reference: PriceReference | None = None
    value: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def one_right_operand(self) -> PriceComparisonCondition:
        if (self.right_reference is None) == (self.value is None):
            raise ValueError("exactly one of right_reference or value is required")
        return self


class MovingAverageRelationCondition(FrozenStrictModel):
    timeframe: Timeframe
    fast_period: int = Field(ge=1, le=10_000)
    slow_period: int = Field(ge=2, le=10_000)
    operator: Literal["above", "below", "crosses_above", "crosses_below"]

    @model_validator(mode="after")
    def ordered_periods(self) -> MovingAverageRelationCondition:
        if self.fast_period >= self.slow_period:
            raise ValueError("fast_period must be smaller than slow_period")
        return self


class EmaRelationCondition(MovingAverageRelationCondition):
    type: Literal["ema_relation"]


class SmaRelationCondition(MovingAverageRelationCondition):
    type: Literal["sma_relation"]


class RsiThresholdCondition(FrozenStrictModel):
    type: Literal["rsi_threshold"]
    timeframe: Timeframe
    period: int = Field(ge=2, le=10_000)
    operator: ComparisonOperator
    value: float = Field(ge=0, le=100)


class AtrThresholdCondition(FrozenStrictModel):
    type: Literal["atr_threshold"]
    timeframe: Timeframe
    period: int = Field(ge=2, le=10_000)
    operator: Literal["above", "below", "crosses_above", "crosses_below"]
    value: float = Field(gt=0)
    unit: Literal["price", "pips", "percentage"]


class RangeBreakoutCondition(FrozenStrictModel):
    type: Literal["range_breakout"]
    timeframe: Timeframe
    lookback_bars: int = Field(ge=2, le=10_000)
    direction: Literal["above_high", "below_low"]
    confirmation: Literal["close", "high_low"] = "close"
    offset_pips: float = Field(default=0.0, ge=0, le=100_000)


class TradingSession(StrEnum):
    ASIA = "asia"
    LONDON = "london"
    NEW_YORK = "new_york"
    LONDON_NEW_YORK_OVERLAP = "london_new_york_overlap"


class MarketSessionCondition(FrozenStrictModel):
    type: Literal["market_session"]
    sessions: tuple[TradingSession, ...] = Field(min_length=1, max_length=4)

    @field_validator("sessions")
    @classmethod
    def unique_sessions(cls, value: tuple[TradingSession, ...]) -> tuple[TradingSession, ...]:
        if len(set(value)) != len(value):
            raise ValueError("sessions must be unique")
        return tuple(sorted(value, key=str))


class Weekday(StrEnum):
    MONDAY = "monday"
    TUESDAY = "tuesday"
    WEDNESDAY = "wednesday"
    THURSDAY = "thursday"
    FRIDAY = "friday"


class DayOfWeekCondition(FrozenStrictModel):
    type: Literal["day_of_week"]
    days: tuple[Weekday, ...] = Field(min_length=1, max_length=5)

    @field_validator("days")
    @classmethod
    def unique_days(cls, value: tuple[Weekday, ...]) -> tuple[Weekday, ...]:
        if len(set(value)) != len(value):
            raise ValueError("days must be unique")
        return tuple(sorted(value, key=str))


_TIME_PATTERN = r"^(?:[01]\d|2[0-3]):[0-5]\d$"


class TimeWindowCondition(FrozenStrictModel):
    type: Literal["time_window"]
    timezone: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z_]+(?:/[A-Za-z_+-]+)+$")
    start_time: str
    end_time: str
    allow_overnight: bool = False

    @field_validator("start_time", "end_time")
    @classmethod
    def valid_time(cls, value: str) -> str:
        if re.fullmatch(_TIME_PATTERN, value) is None:
            raise ValueError("time must use HH:MM in 24-hour form")
        return value

    @model_validator(mode="after")
    def valid_window(self) -> TimeWindowCondition:
        if self.start_time == self.end_time:
            raise ValueError("time window cannot cover an unspecified full day")
        if self.end_time < self.start_time and not self.allow_overnight:
            raise ValueError("overnight window requires allow_overnight=true")
        return self


ConditionLeaf = Annotated[
    PriceComparisonCondition
    | EmaRelationCondition
    | SmaRelationCondition
    | RsiThresholdCondition
    | AtrThresholdCondition
    | RangeBreakoutCondition
    | MarketSessionCondition
    | DayOfWeekCondition
    | TimeWindowCondition,
    Field(discriminator="type"),
]


class ConditionTree(FrozenStrictModel):
    all: tuple[ConditionLeaf | ConditionTree, ...] | None = Field(
        default=None, min_length=1, max_length=64
    )
    any: tuple[ConditionLeaf | ConditionTree, ...] | None = Field(
        default=None, min_length=1, max_length=64
    )
    not_condition: ConditionLeaf | ConditionTree | None = Field(default=None, alias="not")

    @model_validator(mode="after")
    def exactly_one_operator(self) -> ConditionTree:
        if sum(value is not None for value in (self.all, self.any, self.not_condition)) != 1:
            raise ValueError("condition tree requires exactly one of all, any, or not")
        return self


ConditionTree.model_rebuild()


class StrategyTimeframes(FrozenStrictModel):
    entry: Timeframe
    higher: tuple[Timeframe, ...] = Field(default=(), max_length=3)

    @model_validator(mode="after")
    def valid_higher_timeframes(self) -> StrategyTimeframes:
        if len(set(self.higher)) != len(self.higher):
            raise ValueError("higher timeframes must be unique")
        rank = list(Timeframe)
        entry_rank = rank.index(self.entry)
        if any(rank.index(item) <= entry_rank for item in self.higher):
            raise ValueError("higher timeframes must be greater than the entry timeframe")
        object.__setattr__(self, "higher", tuple(sorted(self.higher, key=rank.index)))
        return self


class OrderType(StrEnum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"


class EntryPriceReference(StrEnum):
    NEXT_BAR_OPEN = "next_bar_open"
    SIGNAL_BAR_CLOSE = "signal_bar_close"
    PREVIOUS_HIGH = "previous_high"
    PREVIOUS_LOW = "previous_low"
    INDICATOR_VALUE = "indicator_value"
    FIXED_OFFSET_FROM_SIGNAL_CLOSE = "fixed_offset_from_signal_close"


class IndicatorReference(FrozenStrictModel):
    indicator: Literal["ema", "sma", "atr"]
    timeframe: Timeframe
    period: int = Field(ge=1, le=10_000)


class EntryModel(FrozenStrictModel):
    order_type: OrderType
    price_reference: EntryPriceReference
    offset_type: Literal["none", "pips", "ticks", "percentage", "price"]
    offset_value: float = Field(ge=0, le=1_000_000)
    indicator: IndicatorReference | None = None
    valid_for_bars: int = Field(ge=1, le=100_000)
    cancel_on_opposite_signal: bool
    allow_reentry: bool
    cooldown_bars: int = Field(ge=0, le=100_000)

    @model_validator(mode="after")
    def consistent_entry(self) -> EntryModel:
        if self.order_type is OrderType.MARKET:
            if self.price_reference is not EntryPriceReference.NEXT_BAR_OPEN:
                raise ValueError("market entries execute only at next_bar_open")
            if self.offset_type != "none" or self.offset_value != 0:
                raise ValueError("market entries cannot define an offset")
        elif self.price_reference is EntryPriceReference.NEXT_BAR_OPEN:
            raise ValueError("next_bar_open is reserved for market entries")
        if self.price_reference is EntryPriceReference.INDICATOR_VALUE:
            if self.indicator is None:
                raise ValueError("indicator reference is required")
        elif self.indicator is not None:
            raise ValueError("indicator is only valid with indicator_value")
        if self.offset_type == "none" and self.offset_value != 0:
            raise ValueError("offset_value must be zero when offset_type is none")
        if self.offset_type != "none" and self.offset_value <= 0:
            raise ValueError("a positive offset_value is required")
        return self


class FixedPipsStop(FrozenStrictModel):
    type: Literal["fixed_pips"]
    value: float = Field(gt=0, le=1_000_000)


class AtrMultipleStop(FrozenStrictModel):
    type: Literal["atr_multiple"]
    value: float = Field(gt=0, le=1_000)
    period: int = Field(default=14, ge=2, le=10_000)
    timeframe: Timeframe | None = None


class RecentSwingStop(FrozenStrictModel):
    type: Literal["recent_swing"]
    lookback_bars: int = Field(ge=2, le=10_000)
    buffer_pips: float = Field(default=0.0, ge=0, le=1_000_000)


class PercentageStop(FrozenStrictModel):
    type: Literal["percentage"]
    value: float = Field(gt=0, le=100)


class StructureLevelStop(FrozenStrictModel):
    type: Literal["structure_level"]
    lookback_bars: int = Field(ge=5, le=10_000)
    buffer_pips: float = Field(default=0.0, ge=0, le=1_000_000)


StopLoss = Annotated[
    FixedPipsStop | AtrMultipleStop | RecentSwingStop | PercentageStop | StructureLevelStop,
    Field(discriminator="type"),
]


class TargetBase(FrozenStrictModel):
    size_percent: float = Field(gt=0, le=100)


class FixedPipsTarget(TargetBase):
    type: Literal["fixed_pips"]
    value: float = Field(gt=0, le=1_000_000)


class RiskRewardTarget(TargetBase):
    type: Literal["risk_reward"]
    value: float = Field(gt=0, le=1_000)


class AtrMultipleTarget(TargetBase):
    type: Literal["atr_multiple"]
    value: float = Field(gt=0, le=1_000)
    period: int = Field(default=14, ge=2, le=10_000)
    timeframe: Timeframe | None = None


class PercentageTarget(TargetBase):
    type: Literal["percentage"]
    value: float = Field(gt=0, le=100)


class StructureLevelTarget(TargetBase):
    type: Literal["structure_level"]
    lookback_bars: int = Field(ge=5, le=10_000)
    buffer_pips: float = Field(default=0.0, ge=0, le=1_000_000)


TakeProfitTarget = Annotated[
    FixedPipsTarget
    | RiskRewardTarget
    | AtrMultipleTarget
    | PercentageTarget
    | StructureLevelTarget,
    Field(discriminator="type"),
]


class FixedLotSizing(FrozenStrictModel):
    type: Literal["fixed_lot"]
    lots: float = Field(gt=0, le=10_000)


class FixedNotionalSizing(FrozenStrictModel):
    type: Literal["fixed_notional"]
    notional: float = Field(gt=0, le=1_000_000_000)
    currency: Literal["USD"]


class RiskPercentSizing(FrozenStrictModel):
    type: Literal["risk_percent"]
    risk_percent: float = Field(gt=0, le=100)
    account_currency: Literal["USD"]


PositionSizing = Annotated[
    FixedLotSizing | FixedNotionalSizing | RiskPercentSizing, Field(discriminator="type")
]


class BreakEvenRule(FrozenStrictModel):
    trigger_type: Literal["r_multiple", "target", "pips"]
    trigger_value: float = Field(gt=0, le=1_000_000)
    new_stop_offset_pips: float = Field(default=0.0, ge=-1_000_000, le=1_000_000)
    apply_after_target: int | None = Field(default=None, ge=1, le=10)

    @model_validator(mode="after")
    def target_trigger_consistent(self) -> BreakEvenRule:
        if self.trigger_type == "target" and self.apply_after_target is None:
            raise ValueError("target trigger requires apply_after_target")
        if self.trigger_type != "target" and self.apply_after_target is not None:
            raise ValueError("apply_after_target is only valid for target trigger")
        return self


class TrailingStopRule(FrozenStrictModel):
    type: Literal["fixed_pips", "atr_multiple", "recent_swing"]
    value: float = Field(gt=0, le=1_000_000)
    activation_r: float = Field(ge=0, le=1_000)
    update_every_bars: int = Field(ge=1, le=10_000)
    activation_timing: Literal["next_bar"] = "next_bar"
    price_basis: Literal["close", "intrabar"]
    tightening_only: Literal[True] = True


class TradeManagement(FrozenStrictModel):
    move_to_break_even: BreakEvenRule | None = None
    trailing_stop: TrailingStopRule | None = None
    maximum_holding_bars: int = Field(ge=1, le=1_000_000)
    close_on_opposite_signal: bool
    session_close_exit: bool


class RiskControls(FrozenStrictModel):
    max_open_positions: int = Field(ge=1, le=1_000)
    max_positions_per_symbol: int = Field(ge=1, le=100)
    max_daily_loss_percent: float = Field(gt=0, le=100)
    max_consecutive_losses: int = Field(ge=1, le=1_000)
    cooldown_after_loss_bars: int = Field(ge=0, le=1_000_000)
    daily_trade_limit: int = Field(ge=1, le=100_000)
    minimum_reward_risk: float = Field(gt=0, le=1_000)

    @model_validator(mode="after")
    def positions_consistent(self) -> RiskControls:
        if self.max_positions_per_symbol > self.max_open_positions:
            raise ValueError("max_positions_per_symbol cannot exceed max_open_positions")
        return self


class NoSpread(FrozenStrictModel):
    type: Literal["none"]


class FixedPipsSpread(FrozenStrictModel):
    type: Literal["fixed_pips"]
    value: float = Field(ge=0, le=1_000_000)


class BarColumnSpread(FrozenStrictModel):
    type: Literal["bar_column"]
    column: Literal["spread"] = "spread"


class SessionSpreadValue(FrozenStrictModel):
    session: TradingSession
    pips: float = Field(ge=0, le=1_000_000)


class SessionScheduleSpread(FrozenStrictModel):
    type: Literal["session_schedule"]
    values: tuple[SessionSpreadValue, ...] = Field(min_length=1, max_length=4)

    @field_validator("values")
    @classmethod
    def unique_sessions(
        cls, value: tuple[SessionSpreadValue, ...]
    ) -> tuple[SessionSpreadValue, ...]:
        sessions = [item.session for item in value]
        if len(set(sessions)) != len(sessions):
            raise ValueError("spread schedule sessions must be unique")
        return tuple(sorted(value, key=lambda item: str(item.session)))


SpreadPolicy = Annotated[
    NoSpread | FixedPipsSpread | BarColumnSpread | SessionScheduleSpread,
    Field(discriminator="type"),
]


class NoSlippage(FrozenStrictModel):
    type: Literal["none"]


class FixedPipsSlippage(FrozenStrictModel):
    type: Literal["fixed_pips"]
    value: float = Field(ge=0, le=1_000_000)


class FixedTicksSlippage(FrozenStrictModel):
    type: Literal["fixed_ticks"]
    value: float = Field(ge=0, le=1_000_000)


class PercentageSlippage(FrozenStrictModel):
    type: Literal["percentage"]
    value: float = Field(ge=0, le=100)


class SeededDistributionSlippage(FrozenStrictModel):
    type: Literal["seeded_distribution"]
    distribution: Literal["normal", "uniform"]
    seed: int = Field(ge=0, le=2**63 - 1)
    mean: float = Field(default=0.0, ge=-1_000_000, le=1_000_000)
    standard_deviation: float = Field(gt=0, le=1_000_000)
    maximum_absolute_pips: float = Field(gt=0, le=1_000_000)


SlippagePolicy = Annotated[
    NoSlippage
    | FixedPipsSlippage
    | FixedTicksSlippage
    | PercentageSlippage
    | SeededDistributionSlippage,
    Field(discriminator="type"),
]


class NoCommission(FrozenStrictModel):
    type: Literal["none"]


class CommissionValue(FrozenStrictModel):
    value: float = Field(ge=0, le=1_000_000)
    currency: Literal["USD"] = "USD"


class PerLotPerSideCommission(CommissionValue):
    type: Literal["per_lot_per_side"]


class PerTradeCommission(CommissionValue):
    type: Literal["per_trade"]


class PercentageNotionalCommission(FrozenStrictModel):
    type: Literal["percentage_notional"]
    value: float = Field(ge=0, le=100)


CommissionPolicy = Annotated[
    NoCommission | PerLotPerSideCommission | PerTradeCommission | PercentageNotionalCommission,
    Field(discriminator="type"),
]


class NoCarry(FrozenStrictModel):
    type: Literal["none"]
    require_accurate: Literal[False] = False


class FixedDailyCarry(FrozenStrictModel):
    type: Literal["fixed_daily"]
    value_per_lot: float = Field(ge=-1_000_000, le=1_000_000)
    currency: Literal["USD"] = "USD"
    require_accurate: Literal[False] = False


class BarColumnCarry(FrozenStrictModel):
    type: Literal["bar_column"]
    column: Literal["swap_or_carry"] = "swap_or_carry"
    require_accurate: bool


CarryPolicy = Annotated[NoCarry | FixedDailyCarry | BarColumnCarry, Field(discriminator="type")]


class CostModel(FrozenStrictModel):
    spread: SpreadPolicy
    slippage: SlippagePolicy
    commission: CommissionPolicy
    swap_or_carry: CarryPolicy


def _normalize_symbol(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("symbol must be a string")
    return re.sub(r"[/_\-\s]", "", value).upper()


class StrategySpecification(FrozenStrictModel):
    strategy_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    version_id: str = Field(min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2_000)
    market: Literal[Market.FOREX]
    symbols: tuple[str, ...] = Field(min_length=1, max_length=20)
    enabled: bool
    created_at: datetime
    spec_version: Literal["1.0.0"] = SPEC_VERSION
    timeframes: StrategyTimeframes
    direction: Direction
    entry_conditions: ConditionTree | None = None
    long_entry_conditions: ConditionTree | None = None
    short_entry_conditions: ConditionTree | None = None
    entry: EntryModel
    stop_loss: StopLoss
    targets: tuple[TakeProfitTarget, ...] = Field(min_length=1, max_length=10)
    position_sizing: PositionSizing
    management: TradeManagement
    risk_controls: RiskControls
    costs: CostModel

    @field_validator("created_at")
    @classmethod
    def aware_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("created_at must be timezone-aware")
        return value.astimezone(UTC)

    @field_validator("symbols", mode="before")
    @classmethod
    def normalize_symbols(cls, value: object) -> object:
        if not isinstance(value, list | tuple):
            return value
        normalized = tuple(_normalize_symbol(item) for item in value)
        if len(set(normalized)) != len(normalized):
            raise ValueError("duplicate normalized symbols are not allowed")
        unknown = sorted(set(normalized) - SYMBOL_REGISTRY.keys())
        if unknown:
            raise ValueError(f"unsupported symbol metadata: {', '.join(unknown)}")
        return tuple(sorted(normalized))

    @model_validator(mode="after")
    def strategy_consistency(self) -> StrategySpecification:
        if self.direction in (Direction.LONG, Direction.SHORT):
            if self.entry_conditions is None:
                raise ValueError("single-direction strategy requires entry_conditions")
            if self.long_entry_conditions is not None or self.short_entry_conditions is not None:
                raise ValueError("direction-specific trees are only valid when direction is both")
        else:
            if self.entry_conditions is not None:
                raise ValueError("direction both requires separate long and short condition trees")
            if self.long_entry_conditions is None or self.short_entry_conditions is None:
                raise ValueError(
                    "direction both requires long_entry_conditions and short_entry_conditions"
                )

        total = sum(target.size_percent for target in self.targets)
        if abs(total - 100.0) > 1e-9:
            raise ValueError("target size_percent values must total exactly 100")

        if isinstance(self.position_sizing, RiskPercentSizing):
            unsupported = [
                symbol
                for symbol in self.symbols
                if SYMBOL_REGISTRY[symbol].quote_currency != self.position_sizing.account_currency
            ]
            if unsupported:
                raise ValueError(
                    "risk_percent sizing requires direct quote-currency support; unsupported: "
                    + ", ".join(unsupported)
                )

        allowed_timeframes = {self.timeframes.entry, *self.timeframes.higher}
        for tree in self.condition_trees():
            depth, count = _tree_shape(tree)
            if depth > 8 or count > 256:
                raise ValueError("condition tree exceeds depth or leaf limits")
            for leaf in _condition_leaves(tree):
                timeframe = getattr(leaf, "timeframe", None)
                if timeframe is not None and timeframe not in allowed_timeframes:
                    raise ValueError("condition timeframe must be declared in timeframes")
        return self

    def condition_trees(self) -> tuple[ConditionTree, ...]:
        return tuple(
            tree
            for tree in (
                self.entry_conditions,
                self.long_entry_conditions,
                self.short_entry_conditions,
            )
            if tree is not None
        )


def _condition_leaves(tree: ConditionTree) -> tuple[ConditionLeaf, ...]:
    children = tree.all or tree.any
    if children is None:
        child = tree.not_condition
        if child is None:
            return ()
        children = (child,)
    leaves: list[ConditionLeaf] = []
    for child in children:
        if isinstance(child, ConditionTree):
            leaves.extend(_condition_leaves(child))
        else:
            leaves.append(child)
    return tuple(leaves)


def _tree_shape(tree: ConditionTree) -> tuple[int, int]:
    children = tree.all or tree.any
    if children is None:
        children = (tree.not_condition,) if tree.not_condition is not None else ()
    depth = 1
    leaves = 0
    for child in children:
        if isinstance(child, ConditionTree):
            child_depth, child_leaves = _tree_shape(child)
            depth = max(depth, child_depth + 1)
            leaves += child_leaves
        else:
            leaves += 1
    return depth, leaves
