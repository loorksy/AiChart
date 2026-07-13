from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any

from .models import Side
from .policies import SymbolMetadata, forex_session


@dataclass(frozen=True, slots=True)
class ExecutionCosts:
    spread_model: str
    fixed_spread_pips: float
    spread_schedule: tuple[tuple[str, float], ...]
    slippage_model: str
    slippage_value: float
    slippage_distribution: str
    slippage_mean: float
    slippage_standard_deviation: float
    slippage_maximum: float
    commission_model: str
    commission_value: float
    carry_model: str
    carry_value_per_lot: float


@dataclass(frozen=True, slots=True)
class Fill:
    reference_price: float
    price: float
    spread_cost_price: float
    slippage_cost_price: float


def _spread(bar: Any, metadata: SymbolMetadata, costs: ExecutionCosts) -> float:
    if costs.spread_model == "none":
        return 0.0
    if costs.spread_model == "bar_column":
        value = getattr(bar, "spread", None)
        if value is None:
            raise ValueError("bar_column spread model requires complete spread coverage")
        return float(value)
    if costs.spread_model == "fixed_pips":
        return costs.fixed_spread_pips * metadata.pip_size
    if costs.spread_model == "session_schedule":
        active = set(forex_session(bar.timestamp).split("+"))
        if {"london", "new_york"}.issubset(active):
            active.add("london_new_york_overlap")
        values = [pips for session, pips in costs.spread_schedule if session in active]
        if not values:
            raise ValueError("session spread schedule has no value for the active session")
        return max(values) * metadata.pip_size
    raise ValueError("unsupported spread model")


def _slippage(
    reference: float,
    metadata: SymbolMetadata,
    costs: ExecutionCosts,
    rng: random.Random,
) -> float:
    if costs.slippage_model == "none":
        return 0.0
    if costs.slippage_model == "fixed_pips":
        return costs.slippage_value * metadata.pip_size
    if costs.slippage_model == "fixed_ticks":
        return costs.slippage_value * metadata.tick_size
    if costs.slippage_model == "percentage":
        return reference * costs.slippage_value / 100
    if costs.slippage_model == "seeded_distribution":
        if costs.slippage_distribution == "uniform":
            sample = rng.uniform(
                costs.slippage_mean - costs.slippage_standard_deviation,
                costs.slippage_mean + costs.slippage_standard_deviation,
            )
        else:
            sample = rng.gauss(costs.slippage_mean, costs.slippage_standard_deviation)
        return min(abs(sample), costs.slippage_maximum) * metadata.pip_size
    raise ValueError("unsupported slippage model")


def executable_fill(
    bar: Any,
    side: Side,
    action: str,
    reference_price: float,
    metadata: SymbolMetadata,
    costs: ExecutionCosts,
    rng: random.Random,
) -> Fill:
    """Convert a mid/reference price to an executable side once, without double charge."""
    is_entry = action == "entry"
    buy = (side == Side.LONG and is_entry) or (side == Side.SHORT and not is_entry)
    ask_name = "ask_open" if reference_price == float(bar.open) else None
    bid_name = "bid_open" if reference_price == float(bar.open) else None
    ask = getattr(bar, ask_name, None) if ask_name else None
    bid = getattr(bar, bid_name, None) if bid_name else None
    spread_cost = 0.0
    if ask is not None and bid is not None:
        base = float(ask if buy else bid)
        spread_cost = abs(base - reference_price)
    else:
        half_spread = _spread(bar, metadata, costs) / 2
        base = reference_price + half_spread if buy else reference_price - half_spread
        spread_cost = half_spread
    slip = _slippage(reference_price, metadata, costs, rng)
    price = base + slip if buy else base - slip
    return Fill(reference_price, price, spread_cost, slip)


def commission(
    size_lots: float, price: float, metadata: SymbolMetadata, costs: ExecutionCosts
) -> float:
    if costs.commission_model == "none":
        return 0.0
    if costs.commission_model == "per_lot_per_side":
        return size_lots * costs.commission_value
    if costs.commission_model == "per_trade":
        return costs.commission_value
    if costs.commission_model == "percentage_notional":
        notional = size_lots * metadata.contract_size * price
        return notional * costs.commission_value / 100
    raise ValueError("unsupported commission model")


def pnl_for_move(
    side: Side, entry: float, exit_: float, size_lots: float, metadata: SymbolMetadata
) -> float:
    direction = 1.0 if side == Side.LONG else -1.0
    return round((exit_ - entry) * direction * size_lots * metadata.contract_size, 10)
