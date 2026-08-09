"""The grid cell state machine, the resting-order mirror, and the two in-memory
repositories the engine drives them through.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger), Copyright
Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Sources:
`backend_api_python/app/services/live_trading/grid_cells.py`
(`GridCellState`, `GridCell`, `bootstrap_idle_cells`,
`release_cancelled_working_orders`),
`.../app/services/grid/resting_orders_repo.py` (`OPEN_STATUSES`,
`GridRestingOrder`, the open/unprocessed queries) and
`.../app/services/live_trading/exchange_orders.py`
(`make_grid_client_order_id`, `make_grid_initial_client_order_id`).

Changed on port:

  * **Postgres becomes memory.** Upstream's two repositories are `qd_grid_cells`
    and `qd_grid_resting_orders` tables reached through a connection pool. A
    simulation run here is a single in-process pass over pushed-in bars, so the
    repositories are dicts and lists with the SAME query shapes and the SAME
    invariants; `app/storage/sqlite.py` persists the finished run. The one
    query that carries real semantics — `filled_quantity > processed_fill_qty`,
    the crash-recovery watermark — is reproduced exactly, including the `1e-12`
    epsilon, as `GridRestingOrderStore.list_unprocessed`.
  * **Client order ids are deterministic.** Upstream mixes `int(time.time())`
    into the resting-order id so two placements on one cell never collide. A
    replay must be reproducible, so the wall clock is replaced by an explicit
    monotonically increasing `seq` the caller owns. The FORMAT and the 32-char
    truncation are unchanged, and the initial-leg id stays exactly as
    deterministic as it is upstream — that determinism is the duplicate-open
    guard, not an accident.
  * `_ensure_table` and every `ON CONFLICT` clause are dropped with their SQL.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app.engine.bots.levels import GridCellSpec

# Statuses an order can be in and still be working on the venue.
OPEN_STATUSES = ("pending", "open", "partial")

# Upstream's four `purpose` values. Never formally enumerated there; they are
# compared as bare strings everywhere, so they are constants here instead of an
# enum — an unexpected value must fall through, not raise.
PURPOSE_LONG_ENTRY = "long_entry"
PURPOSE_LONG_EXIT = "long_exit"
PURPOSE_SHORT_ENTRY = "short_entry"
PURPOSE_SHORT_EXIT = "short_exit"


class GridCellState(str, Enum):
    """Lifecycle states for one cell."""

    IDLE = "idle"
    BUY_OPEN = "buy_open"
    LONG_HELD = "long_held"
    SELL_OPEN = "sell_open"
    SHORT_HELD = "short_held"

    @classmethod
    def parse(cls, raw: Any) -> GridCellState:
        if isinstance(raw, GridCellState):
            return raw
        s = str(raw or "").strip().lower()
        for st in cls:
            if st.value == s:
                return st
        return cls.IDLE


@dataclass
class GridCell:
    """One persisted cell: its band, its state, and the inventory it holds."""

    cell_index: int
    lower_price: float
    upper_price: float
    state: GridCellState = GridCellState.IDLE
    leg_size: float = 0.0
    leg_entry_price: float = 0.0
    working_order_id: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "cell_index": int(self.cell_index),
            "lower_price": float(self.lower_price),
            "upper_price": float(self.upper_price),
            "state": self.state.value,
            "leg_size": float(self.leg_size or 0.0),
            "leg_entry_price": float(self.leg_entry_price or 0.0),
        }


@dataclass
class GridRestingOrder:
    """The local mirror of one resting limit order.

    `filled_quantity` is what the venue says has filled. `processed_fill_qty` is
    how much of that has been posted to the ledger. The gap between them is the
    crash-recovery window and the reason this port keeps two columns where one
    would look sufficient.
    """

    id: int = 0
    cell_index: int = 0
    purpose: str = ""
    side: str = ""
    pos_side: str = ""
    reduce_only: bool = False
    price: float = 0.0
    quantity: float = 0.0
    quote_amount: float = 0.0
    client_order_id: str = ""
    exchange_order_id: str = ""
    status: str = "pending"
    filled_quantity: float = 0.0
    avg_fill_price: float = 0.0
    processed_fill_qty: float = 0.0
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES

    @property
    def remaining_quantity(self) -> float:
        return max(0.0, float(self.quantity or 0.0) - float(self.processed_fill_qty or 0.0))

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": int(self.id),
            "cell_index": int(self.cell_index),
            "purpose": self.purpose,
            "side": self.side,
            "pos_side": self.pos_side,
            "reduce_only": bool(self.reduce_only),
            "price": float(self.price),
            "quantity": float(self.quantity),
            "client_order_id": self.client_order_id,
            "exchange_order_id": self.exchange_order_id,
            "status": self.status,
            "filled_quantity": float(self.filled_quantity),
            "avg_fill_price": float(self.avg_fill_price),
            "processed_fill_qty": float(self.processed_fill_qty),
        }


def make_grid_initial_client_order_id(strategy_id: int, leg: str = "") -> str:
    """Stable client oid for the grid's initial market leg.

    Deterministic BY DESIGN: one id per (strategy, leg) means a restart
    mid-flight cannot open the initial position twice.
    """
    suffix = str(leg or "").strip().lower()[:1]
    if suffix not in ("l", "s"):
        suffix = ""
    return f"ginit{int(strategy_id) % 100000:05d}{suffix}"[:32]


def make_grid_client_order_id(strategy_id: int, cell_index: int, purpose: str, seq: int) -> str:
    """Short client oid (32 chars max). purpose: e/x/s/c = long entry/long exit/
    short entry/short exit.

    Upstream mixes the wall clock in to keep repeat placements on one cell
    distinct; `seq` is the deterministic stand-in (see the module docstring).
    """
    p = (purpose or "x")[:1].lower()
    if "long_entry" in purpose:
        p = "e"
    elif "long_exit" in purpose:
        p = "x"
    elif "short_entry" in purpose:
        p = "s"
    elif "short_exit" in purpose:
        p = "c"
    return f"g{int(strategy_id) % 10000:04d}c{int(cell_index):03d}{p}{int(seq) % 99999:05d}"[:32]


class GridCellStore:
    """In-memory `qd_grid_cells`, keyed by cell index."""

    def __init__(self) -> None:
        self._cells: dict[int, GridCell] = {}

    def bootstrap_idle_cells(self, specs: list[GridCellSpec]) -> int:
        """Insert one IDLE row per spec. Idempotent: an existing cell is never
        clobbered, so a restart re-derives the ladder without losing held
        inventory (upstream's `ON CONFLICT ... DO NOTHING`)."""
        created = 0
        for spec in specs:
            if spec.index in self._cells:
                continue
            self._cells[spec.index] = GridCell(
                cell_index=spec.index,
                lower_price=float(spec.lower_price),
                upper_price=float(spec.upper_price),
            )
            created += 1
        return created

    def get(self, cell_index: int) -> GridCell | None:
        return self._cells.get(int(cell_index))

    def list_cells(self) -> list[GridCell]:
        return [self._cells[key] for key in sorted(self._cells)]

    def set_state(
        self,
        cell_index: int,
        state: GridCellState,
        *,
        leg_size: float | None = None,
        leg_entry_price: float | None = None,
        working_order_id: str | None = None,
    ) -> GridCell | None:
        cell = self._cells.get(int(cell_index))
        if cell is None:
            return None
        cell.state = state
        if leg_size is not None:
            cell.leg_size = float(leg_size)
        if leg_entry_price is not None:
            cell.leg_entry_price = float(leg_entry_price)
        if working_order_id is not None:
            cell.working_order_id = str(working_order_id)
        return cell

    def release_cancelled_working_orders(self) -> None:
        """Shutdown housekeeping: reset cells that only had a working ORDER back
        to IDLE, but preserve held inventory and its cost basis.

        `LONG_HELD`/`SHORT_HELD` survive with `leg_size` and `leg_entry_price`
        intact — a cancelled exit does not mean the position vanished.
        """
        for cell in self._cells.values():
            if cell.state in (GridCellState.BUY_OPEN, GridCellState.SELL_OPEN):
                cell.state = GridCellState.IDLE
                cell.leg_size = 0.0
                cell.leg_entry_price = 0.0
            cell.working_order_id = ""


class GridRestingOrderStore:
    """In-memory `qd_grid_resting_orders`."""

    def __init__(self) -> None:
        self._orders: list[GridRestingOrder] = []
        self._next_id = 1

    def insert(self, order: GridRestingOrder) -> GridRestingOrder:
        order.id = self._next_id
        self._next_id += 1
        self._orders.append(order)
        return order

    def all_orders(self) -> list[GridRestingOrder]:
        return list(self._orders)

    def list_open(self, *, purpose: str | None = None, cell_index: int | None = None) -> list[
        GridRestingOrder
    ]:
        return [
            order
            for order in self._orders
            if order.is_open
            and (purpose is None or order.purpose == purpose)
            and (cell_index is None or order.cell_index == int(cell_index))
        ]

    def list_unprocessed(self) -> list[GridRestingOrder]:
        """Upstream's recovery query, epsilon included:

            WHERE filled_quantity > 0 AND processed_fill_qty + 1e-12 < filled_quantity

        Anything this returns has filled on the venue but has not yet reached
        the ledger. It is the exact set a crash would leave behind.
        """
        return [
            order
            for order in self._orders
            if order.filled_quantity > 0
            and order.processed_fill_qty + 1e-12 < order.filled_quantity
        ]

    def mark_cancelled(self, order: GridRestingOrder) -> None:
        order.status = "cancelled"
