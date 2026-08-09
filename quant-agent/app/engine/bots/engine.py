"""The grid engine — cells, entries, exits, fills, boundaries.

SIMULATION ONLY. The engine reaches the outside world through exactly one
dependency, `QuantBrokerPort`, and the only implementation of that port in this
repository is `SimulatedQuantBroker`. There is no configuration value, no
environment variable and no feature flag that swaps in a real broker; doing so
would require writing a new class and importing it here, which is a code change
under review. `tests/test_no_execution.py` fails the build if a second
implementation ever appears.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger), Copyright
Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/grid/engine.py` (`GridEngine`) with the runner
sequencing from `.../app/services/grid/runner.py`.

Changed on port:

  * **`create_client_fn` becomes `QuantBrokerPort`.** Upstream calls
    `self._create_client()` from eleven places and every one of them is a REST
    round trip to a venue. They collapse into five port methods —
    `normalize_quantity`, `place_limit`, `cancel`, `account_leg_size`,
    `hedge_mode` — which the simulated broker answers from local state. This is
    the seam the whole track is built around.
  * **The exchange-ownership guards are answered locally.** `_grid_entry_
    ownership_allowed`, `_resolve_grid_exit_quantity`, `resolve_reduce_only_
    quantity` and `clamp_spot_close_quantity` all exist to stop a live engine
    selling inventory it does not own on a shared credential. With one
    simulated account per run there is no shared credential, so the guard that
    survives is the one that still means something: an exit is clamped to the
    ledger's own leg size, never the venue's.
  * **No initial-position exchange recovery.** `_try_recover_initial_from_
    exchange`, `_probe_initial_client_order_fill`, the 0.85/1.05 tolerance
    band, the 3-attempt/30-second retry throttle and the frozen pre-start
    baseline all answer "did my order actually reach the venue?", which cannot
    be in doubt here. The initial market leg's SIZING is ported exactly,
    including the neutral 50/50 split.
  * **No auto-stop lifecycle.** `maybe_auto_stop_on_exchange_error` and
    `auto_stop_live_strategy` stop a live strategy on a live venue. A boundary
    `stop_loss` still asks for the stop and still enqueues the qty-0 close-all
    (zero means "close everything", not "close nothing") — it is recorded on
    the run instead of calling into a lifecycle service.
  * **Logs become a list.** `append_strategy_log` writes to Postgres; the same
    strings, formatted identically, accumulate on `GridEngine.logs` and ride
    back on the run report.
  * **Time becomes bar count.** `order_frequency`'s rate limit is expressed in
    seconds against `time.time()` upstream; here it counts bars, because a
    replay has no wall clock. Set it to 0 (the default) for upstream behaviour.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from app.engine.bots.cells import (
    GridCell,
    GridCellState,
    GridCellStore,
    GridRestingOrder,
    GridRestingOrderStore,
    make_grid_client_order_id,
    make_grid_initial_client_order_id,
)
from app.engine.bots.config import GridBotConfig
from app.engine.bots.fill_handler import (
    GridLedger,
    apply_grid_fill_to_local_state,
)
from app.engine.bots.levels import GridCellSpec, generate_cells, generate_levels


@dataclass
class BrokerOrderRef:
    """What a broker returns when it accepts a limit order."""

    accepted: bool
    exchange_order_id: str = ""
    error: str = ""


@runtime_checkable
class QuantBrokerPort(Protocol):
    """Everything the grid engine needs from the outside world.

    Five methods. Implementing this interface is what "connecting a broker"
    means, and the deliberate consequence is that a reviewer can see the entire
    execution surface of this service on one screen.

    THE ONLY IMPLEMENTATION IN THIS REPOSITORY IS `SimulatedQuantBroker`.
    """

    def normalize_quantity(self, quantity: float, price: float) -> float:
        """Floor a quantity onto the instrument's trade unit. Must be total:
        upstream returns 0.0 on any exception and callers read 0 as "skip", so
        a normalizer that can fail silently disables the whole grid."""
        ...

    def place_limit(self, order: GridRestingOrder) -> BrokerOrderRef:
        """Rest a limit order. `order.id` is already assigned by the store."""
        ...

    def cancel(self, order: GridRestingOrder) -> bool:
        """Withdraw a resting order. False means the cancel did not land, and
        the caller must abort rather than assume the order is gone."""
        ...

    def account_leg_size(self, pos_side: str) -> float:
        """Size the ACCOUNT reports for one leg."""
        ...

    def hedge_mode(self) -> bool:
        """True when long and short may be held simultaneously. A neutral grid
        requires it."""
        ...


class GridEngine:
    """One grid bot's state machine over one instrument."""

    def __init__(
        self,
        *,
        strategy_id: int,
        cfg: GridBotConfig,
        broker: QuantBrokerPort,
        cells: GridCellStore | None = None,
        orders: GridRestingOrderStore | None = None,
        ledger: GridLedger | None = None,
        initial_capital: float = 0.0,
    ) -> None:
        self.strategy_id = int(strategy_id)
        self.cfg = cfg
        self.broker = broker
        self.cells = cells if cells is not None else GridCellStore()
        self.orders = orders if orders is not None else GridRestingOrderStore()
        self.ledger = ledger if ledger is not None else GridLedger()
        self.initial_capital = max(0.0, float(initial_capital or 0.0))
        self.logs: list[tuple[str, str]] = []
        self.runtime_params: dict[str, float | bool | str] = {}

        self._bootstrapped = False
        self._paused_entries = False
        self._stop_requested = False
        self._stop_reason = ""
        self._initial_done = False
        self._coid_seq = 0
        self._bar_index = 0
        self._last_entry_order_bar = -1

    # -- logging -------------------------------------------------------

    def _log(self, level: str, message: str) -> None:
        self.logs.append((level, message))

    @property
    def stop_requested(self) -> bool:
        return self._stop_requested

    @property
    def stop_reason(self) -> str:
        return self._stop_reason

    @property
    def entries_paused(self) -> bool:
        return self._paused_entries

    # -- geometry ------------------------------------------------------

    def levels_and_cells(self) -> tuple[list[float], list[GridCellSpec]]:
        upper, lower = self.cfg.effective_bounds(self.runtime_params)
        levels = generate_levels(lower, upper, self.cfg.grid_line_count, self.cfg.grid_mode)
        return levels, generate_cells(levels)

    def bootstrap(self, current_price: float) -> int:
        levels, specs = self.levels_and_cells()
        created = self.cells.bootstrap_idle_cells(specs)
        self._bootstrapped = True
        upper, lower = self.cfg.effective_bounds(self.runtime_params)
        self._log(
            "info",
            f"Grid resting bootstrap: {created} cells, {self.cfg.grid_direction}, "
            f"bounds [{lower:.4f}, {upper:.4f}]",
        )
        del levels, current_price
        return created

    # -- budget / sizing -----------------------------------------------

    def _initial_capital_usdt(self) -> float:
        init_cap = float(self.initial_capital or 0.0)
        if init_cap <= 0:
            cell_budget = self._grid_budget_usdt() * self.cfg.tradable_cell_count
            init_cap = cell_budget if self.cfg.grid_count_unit == "cells" else cell_budget * 2
        return init_cap

    def _grid_budget_usdt(self) -> float:
        pct_value = max(0.0, float(self.cfg.amount_per_grid_pct or 0.0))
        if pct_value > 0 and self.initial_capital > 0:
            return self.initial_capital * pct_value
        return max(0.0, float(self.cfg.amount_per_grid or 0.0))

    def _qty_from_usdt(self, usdt: float, price: float) -> float:
        if price <= 0 or usdt <= 0:
            return 0.0
        lev = self.cfg.leverage if self.cfg.market_type != "spot" else 1.0
        return float(usdt) * lev / float(price)

    def _normalize_grid_base_qty(self, quantity: float, price: float) -> float:
        return self.broker.normalize_quantity(float(quantity or 0.0), float(price or 0.0))

    def grid_base_qty(self, price: float) -> float:
        """One grid line's base quantity (amountPerGrid x leverage / price)."""
        raw = self._qty_from_usdt(self._grid_budget_usdt(), float(price or 0.0))
        return self._normalize_grid_base_qty(raw, price)

    def target_initial_usdt(self) -> float:
        return self._initial_capital_usdt() * float(self.cfg.initial_position_pct or 0.0)

    # -- cell helpers --------------------------------------------------

    def _cell_state_by_index(self) -> dict[int, GridCellState]:
        return {cell.cell_index: cell.state for cell in self.cells.list_cells()}

    def _has_open_for_cell(self, cell_index: int, purpose: str) -> bool:
        return bool(self.orders.list_open(purpose=purpose, cell_index=cell_index))

    def _cell_allows_entry(
        self, cell_index: int, purpose: str, cell_states: dict[int, GridCellState]
    ) -> bool:
        """Only IDLE cells with neither a working entry nor a working exit."""
        idx = int(cell_index)
        st = cell_states.get(idx, GridCellState.IDLE)
        if purpose == "long_entry":
            if st != GridCellState.IDLE:
                return False
            if self._has_open_for_cell(idx, "long_entry"):
                return False
            return not self._has_open_for_cell(idx, "long_exit")
        if purpose == "short_entry":
            if st != GridCellState.IDLE:
                return False
            if self._has_open_for_cell(idx, "short_entry"):
                return False
            return not self._has_open_for_cell(idx, "short_exit")
        return False

    # -- order placement -----------------------------------------------

    def _place_limit(
        self,
        cell: GridCellSpec,
        purpose: str,
        side: str,
        price: float,
        *,
        reduce_only: bool,
        pos_side: str,
        quantity: float | None = None,
    ) -> bool:
        px = float(price or 0.0)
        if px <= 0:
            return False
        usdt = self._grid_budget_usdt()
        qty = float(quantity) if quantity is not None else self._qty_from_usdt(usdt, px)
        qty = self._normalize_grid_base_qty(qty, px)
        if reduce_only:
            qty = min(qty, self._resolve_exit_quantity(pos_side, qty))
            qty = self._normalize_grid_base_qty(qty, px)
        if qty <= 0:
            return False

        self._coid_seq += 1
        # Reduce-only exits are never post-only: they must be able to cross.
        post_only = not reduce_only and self.cfg.order_mode in (
            "maker",
            "limit",
            "limit_first",
            "maker_then_market",
        )
        order = GridRestingOrder(
            cell_index=cell.index,
            purpose=purpose,
            side=side,
            pos_side=pos_side,
            reduce_only=reduce_only,
            price=px,
            quantity=qty,
            quote_amount=qty * px,
            client_order_id=make_grid_client_order_id(
                self.strategy_id, cell.index, purpose, self._coid_seq
            ),
            status="open",
            extra={"post_only": post_only},
        )
        self.orders.insert(order)
        ref = self.broker.place_limit(order)
        if not ref.accepted:
            # Upstream cancels the venue order when the DB insert fails; the
            # mirror image here is dropping the local row when the venue
            # refuses, so a rejected order never looks like a resting one.
            self.orders.mark_cancelled(order)
            self._log("error", f"Grid limit failed {purpose}: {ref.error}")
            return False
        order.exchange_order_id = ref.exchange_order_id

        if reduce_only and pos_side == "long":
            state = GridCellState.LONG_HELD
        elif reduce_only and pos_side == "short":
            state = GridCellState.SHORT_HELD
        elif purpose == "long_entry":
            state = GridCellState.BUY_OPEN
        elif purpose == "short_entry":
            state = GridCellState.SELL_OPEN
        else:
            state = GridCellState.BUY_OPEN if side == "buy" else GridCellState.SELL_OPEN
        record = self.cells.get(cell.index)
        # Entries write the order price as the cell's basis; exits must keep the
        # basis the entry established, or a re-hung exit would rewrite history.
        entry_basis = px if not reduce_only else self._cell_cost_basis(cell, purpose)
        self.cells.set_state(
            cell.index,
            state,
            leg_size=qty if not reduce_only else (record.leg_size if record else qty),
            leg_entry_price=entry_basis,
            working_order_id=order.client_order_id,
        )
        return True

    def _cell_cost_basis(self, cell: GridCellSpec, purpose: str) -> float:
        record = self.cells.get(cell.index)
        if record is not None and float(record.leg_entry_price or 0.0) > 0:
            return float(record.leg_entry_price)
        return float(cell.lower_price if purpose == "long_exit" else cell.upper_price)

    def _resolve_exit_quantity(self, pos_side: str, requested: float) -> float:
        """Never offer more than the strategy's OWN leg holds, minus what other
        open exits on that leg have already reserved. Fail-closed: an
        unverifiable budget yields 0, which reads as "skip"."""
        owned = max(0.0, self.ledger.leg_position_qty(pos_side))
        reserved = sum(
            order.remaining_quantity
            for order in self.orders.list_open()
            if (order.reduce_only or order.purpose.endswith("_exit"))
            and order.pos_side == pos_side
        )
        return max(0.0, min(float(requested or 0.0), owned - reserved))

    def _ensure_cell_exit_coverage(
        self,
        cell: GridCellSpec,
        *,
        purpose: str,
        side: str,
        price: float,
        pos_side: str,
        quantity: float,
    ) -> bool:
        """Keep exactly one reduce-only exit equal to the cell's held size."""
        desired = self._normalize_grid_base_qty(float(quantity or 0.0), float(price or 0.0))
        if desired <= 0:
            return False
        open_orders = self.orders.list_open(purpose=purpose, cell_index=cell.index)
        covered = sum(order.remaining_quantity for order in open_orders)
        tolerance = max(1e-10, desired * 1e-8)
        if abs(covered - desired) <= tolerance:
            return True
        for item in open_orders:
            if not self.broker.cancel(item):
                return False
            self.orders.mark_cancelled(item)
        return self._place_limit(
            cell,
            purpose,
            side,
            price,
            reduce_only=True,
            pos_side=pos_side,
            quantity=desired,
        )

    # -- entry synchronisation ------------------------------------------

    def sync_grid_orders(self, current_price: float) -> int:
        if not self._bootstrapped or self._paused_entries or current_price <= 0:
            return 0
        if self.runtime_params.get("waterfall_pause"):
            return 0
        direction = self.cfg.grid_direction
        entry_sides = (
            ("long", "short")
            if direction == "neutral"
            else ((direction,) if direction in ("long", "short") else ())
        )
        if not entry_sides:
            return 0
        if direction == "neutral" and not self.broker.hedge_mode():
            self._log("warning", "Grid neutral entries skipped: account is not in hedge mode")
            return 0
        if self.cfg.order_frequency > 0 and self._last_entry_order_bar >= 0:
            if self._bar_index - self._last_entry_order_bar < int(self.cfg.order_frequency):
                return 0

        _levels, cells = self.levels_and_cells()
        cell_states = self._cell_state_by_index()
        placed = 0
        open_entries = sum(
            1
            for order in self.orders.list_open()
            if order.purpose in ("long_entry", "short_entry")
        )
        remaining_slots = max(0, int(self.cfg.max_open_orders or 0) - int(open_entries))
        if remaining_slots <= 0:
            return 0

        if direction == "neutral":
            return self._sync_neutral_entries(cells, cell_states, current_price, remaining_slots)

        for cell in cells:
            if placed >= remaining_slots:
                break
            if direction == "long" and cell.lower_price < current_price:
                if self._cell_allows_entry(cell.index, "long_entry", cell_states):
                    if self._place_limit(
                        cell,
                        "long_entry",
                        "buy",
                        cell.lower_price,
                        reduce_only=False,
                        pos_side="long",
                    ):
                        placed += 1
                        cell_states[cell.index] = GridCellState.BUY_OPEN
                        self._last_entry_order_bar = self._bar_index
                        if placed >= remaining_slots:
                            break
            if direction == "short" and cell.upper_price > current_price:
                if self._cell_allows_entry(cell.index, "short_entry", cell_states):
                    if self._place_limit(
                        cell,
                        "short_entry",
                        "sell",
                        cell.upper_price,
                        reduce_only=False,
                        pos_side="short",
                    ):
                        placed += 1
                        cell_states[cell.index] = GridCellState.SELL_OPEN
                        self._last_entry_order_bar = self._bar_index
        return placed

    def _sync_neutral_entries(
        self,
        cells: list[GridCellSpec],
        cell_states: dict[int, GridCellState],
        current_price: float,
        remaining_slots: int,
    ) -> int:
        """Round-robin fair allocation between the two legs.

        Each pass serves the purpose with the fewest open orders (long first on
        a tie), advances that purpose's cursor by exactly one candidate, and
        breaks out after one attempt — so a long candidate that fails its cell
        check does not let the long leg run away with every slot.
        """
        placed = 0
        open_by_purpose = {"long_entry": 0, "short_entry": 0}
        for order in self.orders.list_open():
            if order.purpose in open_by_purpose:
                open_by_purpose[order.purpose] += 1

        long_cells = sorted(
            (cell for cell in cells if cell.lower_price < current_price),
            key=lambda cell: cell.lower_price,
            reverse=True,
        )
        short_cells = sorted(
            (cell for cell in cells if cell.upper_price > current_price),
            key=lambda cell: cell.upper_price,
        )
        candidates = {"long_entry": long_cells, "short_entry": short_cells}
        next_index = {"long_entry": 0, "short_entry": 0}

        while placed < remaining_slots:
            purposes = sorted(
                ("long_entry", "short_entry"),
                key=lambda purpose: (
                    open_by_purpose[purpose],
                    0 if purpose == "long_entry" else 1,
                ),
            )
            placed_one = False
            for purpose in purposes:
                side = "buy" if purpose == "long_entry" else "sell"
                pos_side = "long" if purpose == "long_entry" else "short"
                pool = candidates[purpose]
                while next_index[purpose] < len(pool):
                    cell = pool[next_index[purpose]]
                    next_index[purpose] += 1
                    if not self._cell_allows_entry(cell.index, purpose, cell_states):
                        continue
                    target = cell.lower_price if purpose == "long_entry" else cell.upper_price
                    if self._place_limit(
                        cell, purpose, side, target, reduce_only=False, pos_side=pos_side
                    ):
                        placed += 1
                        open_by_purpose[purpose] += 1
                        cell_states[cell.index] = (
                            GridCellState.BUY_OPEN
                            if purpose == "long_entry"
                            else GridCellState.SELL_OPEN
                        )
                        self._last_entry_order_bar = self._bar_index
                        placed_one = True
                    break
                if placed_one or placed >= remaining_slots:
                    break
            if not placed_one:
                break
        return placed

    def sync_held_cell_exits(self, current_price: float) -> int:
        """Re-hang grid-sized exits for cells holding inventory with no exit."""
        if not self._bootstrapped or current_price <= 0:
            return 0
        direction = self.cfg.grid_direction
        if direction not in ("long", "short", "neutral"):
            return 0
        placed = 0
        _levels, cells = self.levels_and_cells()
        cell_map = {spec.index: spec for spec in cells}
        for cell in self.cells.list_cells():
            spec = cell_map.get(cell.cell_index)
            if spec is None:
                continue
            if direction in ("long", "neutral") and cell.state == GridCellState.LONG_HELD:
                if self._has_open_for_cell(cell.cell_index, "long_exit"):
                    continue
                qty = self._normalize_grid_base_qty(float(cell.leg_size or 0.0), spec.upper_price)
                if qty <= 0:
                    continue
                if self._place_limit(
                    spec,
                    "long_exit",
                    "sell",
                    spec.upper_price,
                    reduce_only=True,
                    pos_side="long",
                    quantity=qty,
                ):
                    placed += 1
            elif direction in ("short", "neutral") and cell.state == GridCellState.SHORT_HELD:
                if self._has_open_for_cell(cell.cell_index, "short_exit"):
                    continue
                qty = self._normalize_grid_base_qty(float(cell.leg_size or 0.0), spec.lower_price)
                if qty <= 0:
                    continue
                if self._place_limit(
                    spec,
                    "short_exit",
                    "buy",
                    spec.lower_price,
                    reduce_only=True,
                    pos_side="short",
                    quantity=qty,
                ):
                    placed += 1
        return placed

    # -- fills -----------------------------------------------------------

    def on_order_filled(
        self,
        order: GridRestingOrder,
        filled_qty: float,
        avg_price: float,
        *,
        commission: float = 0.0,
    ) -> None:
        """Post one fill to the ledger, then move the cell.

        THE ORDER OF THE FIRST TWO STATEMENTS IS THE CRASH-RECOVERY CONTRACT:
        the ledger write happens first, and only once it has returned does
        `processed_fill_qty` advance. A crash in between leaves
        `filled_quantity > processed_fill_qty`, which
        `GridRestingOrderStore.list_unprocessed` finds on restart.
        """
        fq = float(filled_qty or order.quantity or 0.0)
        px = float(avg_price or order.price or 0.0)
        outcome = apply_grid_fill_to_local_state(
            self.ledger, self.cells, order, fq, px, commission=commission
        )
        if outcome.applied:
            order.processed_fill_qty = min(
                float(order.filled_quantity or 0.0),
                float(order.processed_fill_qty or 0.0) + fq,
            )

        _levels, cells = self.levels_and_cells()
        cell_map = {spec.index: spec for spec in cells}
        cell = cell_map.get(order.cell_index)
        if cell is None:
            return
        purpose = str(order.purpose or "")
        persisted = self.cells.get(cell.index)
        persisted_state = persisted.state if persisted else GridCellState.IDLE
        persisted_qty = max(0.0, float(persisted.leg_size if persisted else 0.0))
        persisted_entry = max(0.0, float(persisted.leg_entry_price if persisted else 0.0))
        self._log("info", f"Grid fill {purpose} cell={order.cell_index} qty={fq:.6f} @ {px:.4f}")

        if self._paused_entries or self.runtime_params.get("waterfall_pause"):
            if not purpose.endswith("_exit") and self.cfg.boundary_action == "pause":
                return

        if purpose == "long_entry":
            self._on_entry_fill(
                cell, persisted_state, persisted_qty, persisted_entry, fq, px, "long"
            )
        elif purpose == "long_exit":
            self._on_exit_fill(cell, persisted_qty, fq, "long")
        elif purpose == "short_entry":
            self._on_entry_fill(
                cell, persisted_state, persisted_qty, persisted_entry, fq, px, "short"
            )
        elif purpose == "short_exit":
            self._on_exit_fill(cell, persisted_qty, fq, "short")

    def _on_entry_fill(
        self,
        cell: GridCellSpec,
        persisted_state: GridCellState,
        persisted_qty: float,
        persisted_entry: float,
        fq: float,
        px: float,
        leg: str,
    ) -> None:
        held_state = GridCellState.LONG_HELD if leg == "long" else GridCellState.SHORT_HELD
        prior_qty = persisted_qty if persisted_state == held_state else 0.0
        held_qty = prior_qty + fq
        # Weighted-average cost basis across partial entries on one cell.
        held_entry = ((persisted_entry * prior_qty) + (px * fq)) / held_qty if held_qty > 0 else px
        self.cells.set_state(
            cell.index, held_state, leg_size=held_qty, leg_entry_price=held_entry
        )
        exit_purpose = "long_exit" if leg == "long" else "short_exit"
        exit_side = "sell" if leg == "long" else "buy"
        exit_price = cell.upper_price if leg == "long" else cell.lower_price
        exit_ok = self._ensure_cell_exit_coverage(
            cell,
            purpose=exit_purpose,
            side=exit_side,
            price=exit_price,
            pos_side=leg,
            quantity=held_qty,
        )
        if not exit_ok and not self._has_open_for_cell(cell.index, exit_purpose):
            self._log(
                "warning",
                f"Grid {exit_purpose} hang failed after entry fill "
                f"cell={cell.index} @ {exit_price:.4f}",
            )

    def _on_exit_fill(self, cell: GridCellSpec, persisted_qty: float, fq: float, leg: str) -> None:
        held_state = GridCellState.LONG_HELD if leg == "long" else GridCellState.SHORT_HELD
        remaining = max(0.0, persisted_qty - fq)
        state = held_state if remaining > 1e-10 else GridCellState.IDLE
        self.cells.set_state(cell.index, state, leg_size=remaining)
        if remaining > 1e-10 or self._paused_entries:
            return
        entry_purpose = "long_entry" if leg == "long" else "short_entry"
        if not self._cell_allows_entry(cell.index, entry_purpose, self._cell_state_by_index()):
            return
        # Re-hang the ENTRY at exactly the quantity just sold — the cycle-
        # preserving rule; a freshly budgeted quantity would drift the ladder.
        self._place_limit(
            cell,
            entry_purpose,
            "buy" if leg == "long" else "sell",
            cell.lower_price if leg == "long" else cell.upper_price,
            reduce_only=False,
            pos_side=leg,
            quantity=fq,
        )

    def drain_unprocessed_fills(self, *, commission_rate: float = 0.0) -> int:
        """Post every venue fill the ledger has not seen yet.

        This is the recovery path AND the steady-state path — exactly as
        upstream, where the poller and the restart sweep run the same query.
        """
        drained = 0
        for order in self.orders.list_unprocessed():
            new_fill = float(order.filled_quantity) - float(order.processed_fill_qty)
            if new_fill <= 1e-12:
                continue
            price = float(order.avg_fill_price or order.price or 0.0)
            commission = abs(new_fill * price) * max(0.0, float(commission_rate or 0.0))
            self.on_order_filled(order, new_fill, price, commission=commission)
            drained += 1
        return drained

    # -- boundary --------------------------------------------------------

    def handle_boundary(self, current_price: float) -> bool:
        upper, lower = self.cfg.effective_bounds(self.runtime_params)
        if upper <= lower or current_price <= 0:
            return False
        action = self.cfg.boundary_action
        out_of_low = current_price < lower
        out_of_high = current_price > upper
        if self.cfg.grid_direction == "long" and out_of_low:
            triggered = True
        elif self.cfg.grid_direction == "short" and out_of_high:
            triggered = True
        elif self.cfg.grid_direction == "neutral" and (out_of_low or out_of_high):
            triggered = True
        else:
            triggered = False
        if not triggered:
            return False
        side = "below lower" if out_of_low else "above upper"
        detail = (
            f"price={current_price:.4f} is {side} bound "
            f"[{lower:.4f}, {upper:.4f}], direction={self.cfg.grid_direction}"
        )
        if action == "hold":
            self._log("warning", f"Grid out of bounds (hold): {detail}")
            return True
        self.cancel_entry_orders()
        self._paused_entries = True
        self._log("warning", f"Grid out of bounds -> {action}: {detail}")
        if action == "stop_loss":
            self._stop_requested = True
            self._stop_reason = f"grid out of bounds ({detail}); stop_loss requested"
            self._close_all_at(current_price)
        return True

    def cancel_entry_orders(self, pos_side: str | None = None) -> int:
        cancelled = 0
        for order in self.orders.list_open():
            if order.purpose not in ("long_entry", "short_entry"):
                continue
            if pos_side is not None and order.pos_side != pos_side:
                continue
            if self.broker.cancel(order):
                self.orders.mark_cancelled(order)
                cancelled += 1
        return cancelled

    def _close_all_at(self, price: float) -> None:
        """Upstream enqueues market `close_long`/`close_short` with qty 0, where
        zero means "close everything". The simulated equivalent books the close
        against the ledger at the boundary price."""
        for leg in ("long", "short"):
            size = self.ledger.leg_position_qty(leg)
            if size <= 0:
                continue
            signal = "close_long" if leg == "long" else "close_short"
            profit, _pos, matched = self.ledger.apply_fill_to_local_position(signal, size, price)
            self.ledger.record_trade(
                trade_type=signal,
                price=price,
                amount=size,
                profit=profit,
                close_reason="grid_boundary_stop",
                matched_entry_price=matched,
            )
        for order in self.orders.list_open():
            if self.broker.cancel(order):
                self.orders.mark_cancelled(order)

    # -- initial market leg ------------------------------------------------

    def run_initial_market_position(self, price: float) -> bool:
        """The one market order a grid places, sized from initial capital."""
        if self._initial_done:
            return True
        if self.cfg.initial_position_pct <= 0:
            self._initial_done = True
            return True
        if price <= 0:
            return False
        usdt = self.target_initial_usdt()
        if usdt <= 0:
            self._initial_done = True
            return True
        direction = self.cfg.grid_direction
        if direction == "neutral":
            # Upstream splits the notional evenly across both legs and treats
            # either leg succeeding as success.
            half = usdt / 2.0
            ok_long = self._market_leg("open_long", half, price, "grid_initial_long")
            ok_short = self._market_leg("open_short", half, price, "grid_initial_short")
            self._log("info", f"Grid initial neutral market: {usdt:.2f} USDT split @ {price:.4f}")
            self._initial_done = ok_long or ok_short
            return self._initial_done
        if direction == "short":
            self._initial_done = self._market_leg(
                "open_short", usdt, price, "grid_initial_short"
            )
            return self._initial_done
        self._initial_done = self._market_leg("open_long", usdt, price, "grid_initial_long")
        return self._initial_done

    def _market_leg(self, signal: str, usdt: float, price: float, reason: str) -> bool:
        qty = self._normalize_grid_base_qty(self._qty_from_usdt(usdt, price), price)
        if qty <= 0:
            return False
        leg = "l" if signal.endswith("_long") else "s"
        # Deterministic by design — the duplicate-open guard.
        coid = make_grid_initial_client_order_id(self.strategy_id, leg)
        self.ledger.apply_fill_to_local_position(signal, qty, price)
        self.ledger.record_trade(
            trade_type=signal,
            price=price,
            amount=qty,
            close_reason=reason,
            grid_order_id=0,
        )
        self._log("info", f"Grid initial market {reason} qty={qty:.6f} @ {price:.4f} coid={coid}")
        return True

    # -- lifecycle ----------------------------------------------------------

    def advance_bar(self) -> None:
        self._bar_index += 1

    def shutdown(self) -> None:
        for order in self.orders.list_open():
            if self.broker.cancel(order):
                self.orders.mark_cancelled(order)
        self.cells.release_cancelled_working_orders()

    def cell_snapshot(self) -> list[GridCell]:
        return self.cells.list_cells()
