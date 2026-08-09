"""`SimulatedQuantBroker` — the ONLY implementation of `QuantBrokerPort`.

There is no live broker in this repository. This class is what "execution"
means here: limit orders rest in memory and fill against bars `web/` pushes in,
using the same bar-crossing rule QuantDinger's own bar-replay robot uses
(`robot_v2.py`: `crossed = low <= target <= high`). Nothing in this file, or
anywhere else under `app/engine/bots/`, opens a network connection —
`tests/test_no_execution.py` asserts it by walking the import graph.

Derived from QuantDinger (https://github.com/OpenByteInc/QuantDinger), Copyright
Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Sources:
`backend_api_python/app/services/live_trading/exchange_orders.py`
(`normalize_grid_order_quantity`'s flooring contract,
`place_grid_limit_order`/`cancel_grid_order`'s call shapes),
`.../app/services/grid/poller.py` (`_poll_order`'s fill/watermark
reconciliation) and `.../app/services/strategy_runtime/robot_v2.py` (the
bar-crossing rule).

Changed on port — and each change is the point rather than a compromise:

  * **`normalize_quantity` is TOTAL.** Upstream's normalizer calls six private
    client methods and fetches instrument metadata over REST on EVERY order,
    returning `0.0` from a blanket `except`. Callers read 0 as "skip", so a
    flaky venue silently disables an entire grid. Here the instrument spec is
    pushed in as data and the flooring is arithmetic that cannot raise.
  * **The quantity is FLOORED, never rounded up.** That is upstream's rule and
    it is deliberately fail-closed: an exit can never offer more than the cell
    owns.
  * **`hedge_mode()` is a constant `True`.** Upstream hard-blocks a neutral grid
    whose account is not verified in hedge mode
    (`grid/exchange_requirements.py`). A simulated account has no such setting
    and the gate would only ever be an obstacle to running the simulation the
    user asked for, so the simulated account simply supports both legs.
  * **No partial fills.** Upstream reconciles `filled_quantity` growing over
    many polls. A bar either crosses a limit or it does not, so a simulated
    fill is whole. The two-column watermark is still honoured on the write path
    (see `GridEngine.on_order_filled`), because that is where crash recovery
    lives.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from app.engine.bots.cells import GridRestingOrder
from app.engine.bots.config import GridBotConfig
from app.engine.bots.engine import BrokerOrderRef, GridEngine, QuantBrokerPort
from app.engine.bots.fill_handler import GridLedger
from app.engine.bots.validator import DEFAULT_FEE_RATE, validate_grid_config


@dataclass(frozen=True)
class SymbolSpec:
    """The instrument metadata upstream fetches over REST on every order.

    Pushed in here, exactly like bars. `lot_step <= 0` means "no rounding",
    which is what a spot-like instrument with continuous size looks like.
    """

    lot_step: float = 0.0
    min_quantity: float = 0.0
    quantity_precision: int = 8

    def floor_quantity(self, quantity: float) -> float:
        qty = float(quantity or 0.0)
        if not math.isfinite(qty) or qty <= 0:
            return 0.0
        step = float(self.lot_step or 0.0)
        if step > 0:
            # Floor, never round up: an exit must not exceed what is owned.
            # The 1e-9 nudge absorbs binary representation error so a quantity
            # that IS an exact multiple of the step does not lose one unit.
            qty = math.floor(qty / step + 1e-9) * step
        # Precision is applied by truncation for the same reason — `round()`
        # would occasionally round the last digit UP, which is the one
        # direction this function is not allowed to move.
        scale = float(10 ** max(0, int(self.quantity_precision)))
        qty = float(math.floor(qty * scale + 1e-9)) / scale
        if qty < float(self.min_quantity or 0.0):
            return 0.0
        return max(0.0, qty)


@dataclass(frozen=True)
class SimulatedBar:
    """One pushed-in candle, reduced to what a fill decision needs."""

    time: str
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class SimulatedFill:
    """One order crossed by one bar."""

    order_id: int
    bar_time: str
    price: float
    quantity: float
    purpose: str
    cell_index: int


class SimulatedQuantBroker(QuantBrokerPort):
    """Fills limit orders against pushed-in bars. Never touches a network."""

    #: Marks every surface that reports on this broker. Nothing produced here
    #: is a real order, and the string travels with the data so a UI cannot
    #: accidentally present a simulated fill as an executed one.
    execution_mode = "simulation"

    def __init__(self, *, ledger: GridLedger, spec: SymbolSpec | None = None) -> None:
        self._ledger = ledger
        self._spec = spec or SymbolSpec()
        self._resting: dict[int, GridRestingOrder] = {}
        self.fills: list[SimulatedFill] = []

    # -- QuantBrokerPort ------------------------------------------------

    def normalize_quantity(self, quantity: float, price: float) -> float:
        del price  # the spec is size-based; kept in the signature for parity
        return self._spec.floor_quantity(quantity)

    def place_limit(self, order: GridRestingOrder) -> BrokerOrderRef:
        if order.quantity <= 0 or order.price <= 0:
            return BrokerOrderRef(accepted=False, error="invalid_order_size")
        if not order.client_order_id:
            return BrokerOrderRef(accepted=False, error="client_order_id_required")
        self._resting[order.id] = order
        return BrokerOrderRef(accepted=True, exchange_order_id=f"sim:{order.client_order_id}")

    def cancel(self, order: GridRestingOrder) -> bool:
        self._resting.pop(order.id, None)
        return True

    def account_leg_size(self, pos_side: str) -> float:
        # The simulated account IS the strategy ledger: there is no second
        # party trading the same credential, so the two can never disagree.
        return self._ledger.leg_position_qty(pos_side)

    def hedge_mode(self) -> bool:
        return True

    # -- simulation driver ----------------------------------------------

    def push_bar(self, bar: SimulatedBar) -> list[GridRestingOrder]:
        """Cross every resting order this bar touches. Returns them in order id
        order, which is placement order.

        `low <= limit <= high` is inclusive at both ends, matching upstream's
        bar-replay rule. An order fills at its LIMIT price, not the bar's
        close: a resting order that is touched is a resting order that trades
        at the price it advertised.

        Filling flips the order out of `OPEN_STATUSES`, so a later bar in the
        same range cannot fill it a second time.
        """
        low = float(bar.low)
        high = float(bar.high)
        crossed: list[GridRestingOrder] = []
        for order_id in sorted(self._resting):
            order = self._resting[order_id]
            if not order.is_open:
                continue
            limit = float(order.price)
            if not (low <= limit <= high):
                continue
            order.filled_quantity = float(order.quantity)
            order.avg_fill_price = limit
            order.status = "filled"
            crossed.append(order)
            self.fills.append(
                SimulatedFill(
                    order_id=order.id,
                    bar_time=bar.time,
                    price=limit,
                    quantity=float(order.quantity),
                    purpose=order.purpose,
                    cell_index=order.cell_index,
                )
            )
        for order in crossed:
            self._resting.pop(order.id, None)
        return crossed

    @property
    def resting_count(self) -> int:
        return sum(1 for order in self._resting.values() if order.is_open)


@dataclass
class GridSimulationResult:
    """One replay, reported. Every number here came from a simulated fill."""

    execution_mode: str
    ok: bool
    error: str = ""
    warnings: list[str] = field(default_factory=list)
    bar_count: int = 0
    cells_bootstrapped: int = 0
    orders_placed: int = 0
    fill_count: int = 0
    matched_cycles: int = 0
    realized_profit: float = 0.0
    unrealized_profit: float = 0.0
    total_commission: float = 0.0
    ending_price: float = 0.0
    open_position: dict[str, float] = field(default_factory=dict)
    resting_orders: int = 0
    stop_requested: bool = False
    stop_reason: str = ""
    logs: list[dict[str, str]] = field(default_factory=list)
    #: One entry per crossed limit order, in placement order.
    fills: list[dict[str, Any]] = field(default_factory=list)
    #: One entry per ledger write. Longer than `fills` when a boundary
    #: `stop_loss` closes an open position, which books trades without an
    #: order crossing.
    trades: list[dict[str, float | int | str | None]] = field(default_factory=list)
    cells: list[dict[str, Any]] = field(default_factory=list)


def _unrealized(ledger: GridLedger, price: float) -> float:
    total = 0.0
    for side, position in ledger.positions.items():
        if position.size <= 0 or position.entry_price <= 0 or price <= 0:
            continue
        total += (
            (price - position.entry_price) * position.size
            if side == "long"
            else (position.entry_price - price) * position.size
        )
    return total


def run_grid_simulation(
    *,
    strategy_id: int,
    cfg: GridBotConfig,
    bars: Sequence[SimulatedBar],
    initial_capital: float = 0.0,
    fee_rate: float = DEFAULT_FEE_RATE,
    spec: SymbolSpec | None = None,
) -> GridSimulationResult:
    """Replay one grid bot over pushed-in bars, start to finish.

    The sequence mirrors `grid/runner.py`'s `startup` then `tick`, minus every
    step that only exists to talk to a venue (client creation, the dual-leg
    exchange snapshot, the hedge-mode hard block, the fill poller's credential
    budget). What is left is: validate, bootstrap, place the initial leg, arm
    the entry ladder, then per bar — cross, post fills, check bounds, re-arm.

    Fills are posted through `drain_unprocessed_fills`, which is the same
    watermark query a restart would run. A run therefore exercises the recovery
    path on every single bar rather than only after a crash.
    """
    ok, message, warnings = validate_grid_config(
        cfg, initial_capital=initial_capital, fee_rate=fee_rate
    )
    if not ok:
        return GridSimulationResult(
            execution_mode=SimulatedQuantBroker.execution_mode,
            ok=False,
            error=message,
            warnings=list(warnings),
        )
    if not bars:
        return GridSimulationResult(
            execution_mode=SimulatedQuantBroker.execution_mode,
            ok=False,
            error="at least one bar is required to simulate a grid",
            warnings=list(warnings),
        )

    ledger = GridLedger()
    broker = SimulatedQuantBroker(ledger=ledger, spec=spec)
    engine = GridEngine(
        strategy_id=strategy_id,
        cfg=cfg,
        broker=broker,
        ledger=ledger,
        initial_capital=initial_capital,
    )

    opening_price = float(bars[0].open)
    cells_bootstrapped = engine.bootstrap(opening_price)
    engine.handle_boundary(opening_price)
    engine.run_initial_market_position(opening_price)
    orders_placed = engine.sync_grid_orders(opening_price)

    last_price = opening_price
    for bar in bars:
        broker.push_bar(bar)
        engine.drain_unprocessed_fills(commission_rate=fee_rate)
        last_price = float(bar.close)
        engine.handle_boundary(last_price)
        if engine.stop_requested:
            break
        orders_placed += engine.sync_held_cell_exits(last_price)
        orders_placed += engine.sync_grid_orders(last_price)
        engine.advance_bar()

    return GridSimulationResult(
        execution_mode=SimulatedQuantBroker.execution_mode,
        ok=True,
        warnings=list(warnings),
        bar_count=len(bars),
        cells_bootstrapped=cells_bootstrapped,
        orders_placed=orders_placed,
        fill_count=len(broker.fills),
        matched_cycles=ledger.matched_cycle_count,
        realized_profit=ledger.realized_profit,
        unrealized_profit=_unrealized(ledger, last_price),
        total_commission=ledger.total_commission,
        ending_price=last_price,
        open_position={
            side: position.size for side, position in sorted(ledger.positions.items())
        },
        resting_orders=broker.resting_count,
        stop_requested=engine.stop_requested,
        stop_reason=engine.stop_reason,
        logs=[{"level": level, "message": message} for level, message in engine.logs],
        fills=[
            {
                "order_id": fill.order_id,
                "bar_time": fill.bar_time,
                "price": fill.price,
                "quantity": fill.quantity,
                "purpose": fill.purpose,
                "cell_index": fill.cell_index,
            }
            for fill in broker.fills
        ],
        trades=[trade.to_dict() for trade in ledger.trades],
        cells=[cell.to_dict() for cell in engine.cell_snapshot()],
    )
