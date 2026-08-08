"""Turns fired `(bar_index, Signal)` pairs into resolved `SimulatedTrade`s by
scanning forward through the bars that follow the firing bar.

v1 does single-target resolution only (`signal.targets[0]`), not the full
R-multiple ladder -- the plan's own scope note ("no live-broker cost
modeling"). Intrabar tie-break is conservative: a bar whose high/low range
contains both the stop and the target counts as a stop-loss (the worse
outcome), reimplemented natively here from first principles -- no import
from, and no network call to, any `research-service`-like component (this
mirrors that service's own `intrabarPolicy: "worst_case"` in *principle*
only; quant-agent stays a zero-outbound-call, self-contained service).

Outcomes are expressed purely in R-multiples: `(exit_price - entry) /
(entry - stop_loss)`. No currency or account P&L is computed anywhere in
this module -- quant-agent has no capital/leverage model and none is
invented here. A signal that never resolves (neither stop nor target hit)
before the bar series ends is excluded from the trade list entirely, never
force-closed at a synthetic price.
"""

from __future__ import annotations

from typing import Literal

from app.engine.backtest.models import SimulatedTrade
from app.engine.strategies.base import Signal
from app.storage.models import Bar


def simulate_trades(fired: list[tuple[int, Signal]], bars: list[Bar]) -> list[SimulatedTrade]:
    trades: list[SimulatedTrade] = []
    for entry_index, signal in fired:
        trade = _simulate_one(entry_index, signal, bars)
        if trade is not None:
            trades.append(trade)
    return trades


def _simulate_one(entry_index: int, signal: Signal, bars: list[Bar]) -> SimulatedTrade | None:
    if signal.entry is None or not signal.targets:
        return None

    entry = signal.entry
    stop_loss = signal.stop_loss
    target = signal.targets[0]
    # Deliberately not `abs()`: for a well-formed "buy" this is positive
    # (stop below entry); for a well-formed "sell" it is negative (stop
    # above entry) -- and that same sign is what makes the R-multiple
    # formula below correct for both directions without an explicit branch.
    risk = entry - stop_loss
    if risk == 0:
        return None

    for exit_index in range(entry_index + 1, len(bars)):
        bar = bars[exit_index]
        if signal.direction == "buy":
            stop_hit = bar.low <= stop_loss
            target_hit = bar.high >= target
        else:
            stop_hit = bar.high >= stop_loss
            target_hit = bar.low <= target

        if not stop_hit and not target_hit:
            continue

        # Conservative tie-break: a bar that could have hit either counts as
        # the stop (the worse outcome), never the target.
        outcome: Literal["stop", "target"] = "stop" if stop_hit else "target"
        exit_price = stop_loss if outcome == "stop" else target
        r_multiple = (exit_price - entry) / risk

        return SimulatedTrade(
            strategy_id=signal.strategy_id,
            strategy_version=signal.strategy_version,
            direction=signal.direction,
            entry_step_index=entry_index,
            exit_step_index=exit_index,
            entry=entry,
            stop_loss=stop_loss,
            target=target,
            exit_price=exit_price,
            outcome=outcome,
            r_multiple=r_multiple,
        )

    # Never resolved before the bar series ended -- excluded, not
    # force-closed at a synthetic price.
    return None
