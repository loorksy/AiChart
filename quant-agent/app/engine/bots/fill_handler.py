"""The ledger write path: what a grid fill does to positions and trades.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger), Copyright
Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Sources:
`backend_api_python/app/services/grid/fill_handler.py`
(`_PURPOSE_TO_SIGNAL`, `_matched_grid_entry_price`, `_grid_match_profit`,
`apply_grid_fill_to_local_state`, `record_grid_market_fill`) and
`.../app/services/live_trading/records.py` (`apply_fill_to_local_position`).

Changed on port: the two Postgres tables (`qd_strategy_positions`,
`qd_strategy_trades`) become the in-memory `GridLedger`, and the exchange
plumbing around the write — `resolve_leg_context`, `ExecutionEventRepository`
bindings, fee-currency conversion — is gone with the exchange. The arithmetic is
untouched, including the rule that looks like a bug and is not:

    if grid_profit is not None:
        profit = grid_profit
        matched_entry = grid_entry_price

A grid cell's PnL is the distance between ITS two rungs, not the FIFO average of
whatever else the strategy happens to hold. Upstream overrides the FIFO answer
deliberately; "fixing" it would make every cell report a different number than
the grid the user configured.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.engine.bots.cells import GridCellStore, GridRestingOrder

PURPOSE_TO_SIGNAL: dict[str, str] = {
    "long_entry": "open_long",
    "long_exit": "close_long",
    "short_entry": "open_short",
    "short_exit": "close_short",
}


@dataclass
class LedgerPosition:
    """One side's open inventory, weighted-average cost basis included."""

    side: str
    size: float = 0.0
    entry_price: float = 0.0
    highest_price: float = 0.0
    lowest_price: float = 0.0


@dataclass
class LedgerTrade:
    """One recorded fill. `grid_matched_profit` is set only on exits."""

    sequence: int
    trade_type: str
    price: float
    amount: float
    commission: float = 0.0
    profit: float | None = None
    close_reason: str = ""
    matched_entry_price: float | None = None
    grid_matched_profit: float | None = None
    cell_index: int = -1
    grid_order_id: int = 0

    def to_dict(self) -> dict[str, float | int | str | None]:
        return {
            "sequence": int(self.sequence),
            "trade_type": self.trade_type,
            "price": float(self.price),
            "amount": float(self.amount),
            "commission": float(self.commission),
            "profit": None if self.profit is None else float(self.profit),
            "close_reason": self.close_reason,
            "matched_entry_price": (
                None if self.matched_entry_price is None else float(self.matched_entry_price)
            ),
            "grid_matched_profit": (
                None if self.grid_matched_profit is None else float(self.grid_matched_profit)
            ),
            "cell_index": int(self.cell_index),
            "grid_order_id": int(self.grid_order_id),
        }


class GridLedger:
    """Strategy-owned positions and the trade log — the L3 records upstream
    consults instead of the exchange whenever it can, which is precisely why
    they port without an exchange."""

    def __init__(self) -> None:
        self.positions: dict[str, LedgerPosition] = {}
        self.trades: list[LedgerTrade] = []

    # -- positions -----------------------------------------------------

    def leg_position_qty(self, pos_side: str) -> float:
        position = self.positions.get(str(pos_side or "").strip().lower())
        return float(position.size) if position else 0.0

    def apply_fill_to_local_position(
        self, signal_type: str, filled: float, avg_price: float
    ) -> tuple[float | None, LedgerPosition | None, float | None]:
        """(profit, position, matched_entry_price).

        `profit` and `matched_entry_price` are populated on close/reduce fills
        only, from the local entry snapshot — never from the venue.
        """
        sig = (signal_type or "").strip().lower()
        filled_qty = float(filled or 0.0)
        px = float(avg_price or 0.0)
        if filled_qty <= 0 or px <= 0:
            return None, None, None

        if "long" in sig:
            side = "long"
        elif "short" in sig:
            side = "short"
        else:
            return None, None, None

        is_open = sig.startswith("open_") or sig.startswith("add_")
        is_close = sig.startswith("close_") or sig.startswith("reduce_")

        current = self.positions.get(side) or LedgerPosition(side=side)
        cur_size = float(current.size or 0.0)
        cur_entry = float(current.entry_price or 0.0)

        if is_open:
            new_size = cur_size + filled_qty
            if new_size <= 0:
                return None, None, None
            if cur_size > 0 and cur_entry > 0:
                new_entry = (cur_size * cur_entry + filled_qty * px) / new_size
            else:
                new_entry = px
            current.size = new_size
            current.entry_price = new_entry
            current.highest_price = max(current.highest_price or px, px)
            current.lowest_price = min(current.lowest_price or px, px)
            self.positions[side] = current
            return None, current, None

        if is_close:
            profit: float | None = None
            matched_entry: float | None = None
            if cur_size > 0 and cur_entry > 0:
                close_qty = min(cur_size, filled_qty)
                profit = (
                    (px - cur_entry) * close_qty
                    if side == "long"
                    else (cur_entry - px) * close_qty
                )
                matched_entry = cur_entry
            new_size = cur_size - filled_qty
            if new_size <= 0:
                self.positions.pop(side, None)
                return profit, None, matched_entry
            current.size = new_size
            current.highest_price = max(current.highest_price or px, px)
            current.lowest_price = min(current.lowest_price or px, px)
            self.positions[side] = current
            return profit, current, matched_entry

        return None, None, None

    # -- trades --------------------------------------------------------

    def record_trade(
        self,
        *,
        trade_type: str,
        price: float,
        amount: float,
        commission: float = 0.0,
        profit: float | None = None,
        close_reason: str = "",
        matched_entry_price: float | None = None,
        grid_matched_profit: float | None = None,
        cell_index: int = -1,
        grid_order_id: int = 0,
    ) -> LedgerTrade:
        trade = LedgerTrade(
            sequence=len(self.trades) + 1,
            trade_type=trade_type,
            price=float(price),
            amount=float(amount),
            commission=float(commission or 0.0),
            profit=profit,
            close_reason=close_reason,
            matched_entry_price=matched_entry_price,
            grid_matched_profit=grid_matched_profit,
            cell_index=int(cell_index),
            grid_order_id=int(grid_order_id),
        )
        self.trades.append(trade)
        return trade

    @property
    def realized_profit(self) -> float:
        return sum(float(trade.profit or 0.0) for trade in self.trades)

    @property
    def total_commission(self) -> float:
        return sum(float(trade.commission or 0.0) for trade in self.trades)

    @property
    def matched_cycle_count(self) -> int:
        """Completed round trips: one per exit trade that matched a cost basis."""
        return sum(1 for trade in self.trades if trade.grid_matched_profit is not None)


@dataclass
class FillOutcome:
    """What one ledger write produced, for the run report."""

    applied: bool
    signal_type: str = ""
    profit: float | None = None
    matched_entry_price: float | None = None
    trades: list[LedgerTrade] = field(default_factory=list)


def matched_grid_entry_price(cells: GridCellStore, order: GridRestingOrder) -> float:
    """Best-effort cell cost basis for one grid close fill.

    Falls back to the cell's own rung — `lower_price` for a long exit,
    `upper_price` for a short exit — when the cell never recorded an entry, so a
    recovered cell still books a defensible matched price instead of zero.
    """
    purpose = str(order.purpose or "")
    if purpose not in ("long_exit", "short_exit"):
        return 0.0
    cell = cells.get(order.cell_index)
    if cell is None:
        return 0.0
    entry = float(cell.leg_entry_price or 0.0)
    if entry > 0:
        return entry
    if purpose == "long_exit":
        return float(cell.lower_price or 0.0)
    return float(cell.upper_price or 0.0)


def grid_match_profit(
    purpose: str, entry_price: float, exit_price: float, qty: float
) -> float | None:
    if entry_price <= 0 or exit_price <= 0 or qty <= 0:
        return None
    if purpose == "long_exit":
        return (exit_price - entry_price) * qty
    if purpose == "short_exit":
        return (entry_price - exit_price) * qty
    return None


def apply_grid_fill_to_local_state(
    ledger: GridLedger,
    cells: GridCellStore,
    order: GridRestingOrder,
    filled_qty: float,
    avg_price: float,
    *,
    commission: float = 0.0,
) -> FillOutcome:
    """Post one grid fill to the ledger.

    The caller must not advance `order.processed_fill_qty` until this returns —
    that ordering is the whole crash-recovery contract (see
    `GridRestingOrderStore.list_unprocessed`).
    """
    purpose = str(order.purpose or "")
    signal_type = PURPOSE_TO_SIGNAL.get(purpose, "")
    if not signal_type:
        return FillOutcome(applied=False)
    px = float(avg_price or order.price or 0.0)
    qty = float(filled_qty or order.quantity or 0.0)
    if qty <= 0 or px <= 0:
        return FillOutcome(applied=False)

    entry_basis = matched_grid_entry_price(cells, order)
    cell_profit = grid_match_profit(purpose, entry_basis, px, qty)

    profit, _position, matched_entry = ledger.apply_fill_to_local_position(signal_type, qty, px)
    if cell_profit is not None:
        # Deliberate: the cell's own two rungs decide this trade's PnL.
        profit = cell_profit
        matched_entry = entry_basis

    trade = ledger.record_trade(
        trade_type=signal_type,
        price=px,
        amount=qty,
        commission=commission,
        profit=profit,
        close_reason=purpose,
        matched_entry_price=matched_entry,
        grid_matched_profit=(
            profit if purpose in ("long_exit", "short_exit") and profit is not None else None
        ),
        cell_index=order.cell_index,
        grid_order_id=order.id,
    )
    return FillOutcome(
        applied=True,
        signal_type=signal_type,
        profit=profit,
        matched_entry_price=matched_entry,
        trades=[trade],
    )
