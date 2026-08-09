"""The grid engine driven by the simulated broker.

Two properties matter more than the rest and are tested first:

  1. A bar whose range contains a resting limit fills that order EXACTLY ONCE,
     however many later bars also contain it.
  2. `processed_fill_qty` advances only AFTER the ledger write returns, so a
     crash in between leaves the order recoverable and the fill is posted
     exactly once across the crash.
"""

from __future__ import annotations

import pytest

from app.engine.bots.cells import (
    GridCellState,
    GridCellStore,
    GridRestingOrder,
    GridRestingOrderStore,
    make_grid_client_order_id,
    make_grid_initial_client_order_id,
)
from app.engine.bots.config import GridBotConfig
from app.engine.bots.engine import GridEngine
from app.engine.bots.fill_handler import GridLedger, apply_grid_fill_to_local_state
from app.engine.bots.levels import generate_cells, generate_levels
from app.engine.bots.simulated_broker import (
    SimulatedBar,
    SimulatedQuantBroker,
    SymbolSpec,
    run_grid_simulation,
)


def bar(time: str, low: float, high: float, close: float | None = None) -> SimulatedBar:
    mid = (low + high) / 2.0
    return SimulatedBar(
        time=time, open=mid, high=high, low=low, close=mid if close is None else close
    )


def long_grid(**overrides: object) -> GridBotConfig:
    params: dict[str, object] = {
        "lowerPrice": 100.0,
        "upperPrice": 110.0,
        "gridCount": 6,
        "amountPerGrid": 100.0,
        "gridDirection": "long",
    }
    params.update(overrides)
    return GridBotConfig.from_trading_config({"market_type": "spot", "bot_params": params})


def build(cfg: GridBotConfig) -> tuple[GridEngine, SimulatedQuantBroker, GridLedger]:
    ledger = GridLedger()
    broker = SimulatedQuantBroker(ledger=ledger, spec=SymbolSpec())
    engine = GridEngine(
        strategy_id=7, cfg=cfg, broker=broker, ledger=ledger, initial_capital=1000.0
    )
    return engine, broker, ledger


# --------------------------------------------------------------------------
# 1. fill-exactly-once
# --------------------------------------------------------------------------


def test_a_bar_containing_the_limit_fills_it_exactly_once() -> None:
    ledger = GridLedger()
    broker = SimulatedQuantBroker(ledger=ledger)
    orders = GridRestingOrderStore()
    order = orders.insert(
        GridRestingOrder(
            cell_index=0,
            purpose="long_entry",
            side="buy",
            pos_side="long",
            price=102.0,
            quantity=1.0,
            client_order_id="c1",
            status="open",
        )
    )
    assert broker.place_limit(order).accepted

    first = broker.push_bar(bar("t1", low=101.0, high=103.0))
    assert [o.id for o in first] == [order.id]
    assert order.filled_quantity == 1.0

    # The same range again, and a wider one: neither may fill it a second time.
    assert broker.push_bar(bar("t2", low=101.0, high=103.0)) == []
    assert broker.push_bar(bar("t3", low=90.0, high=120.0)) == []
    assert len(broker.fills) == 1
    assert broker.resting_count == 0


def test_the_crossing_test_is_inclusive_at_both_ends() -> None:
    ledger = GridLedger()
    broker = SimulatedQuantBroker(ledger=ledger)
    for index, (low, high) in enumerate([(102.0, 105.0), (99.0, 102.0)]):
        order = GridRestingOrder(
            id=index + 1,
            cell_index=index,
            purpose="long_entry",
            side="buy",
            pos_side="long",
            price=102.0,
            quantity=1.0,
            client_order_id=f"c{index}",
            status="open",
        )
        broker.place_limit(order)
        assert broker.push_bar(bar(f"t{index}", low=low, high=high)) == [order]


def test_a_bar_that_misses_the_limit_does_not_fill_it() -> None:
    ledger = GridLedger()
    broker = SimulatedQuantBroker(ledger=ledger)
    order = GridRestingOrder(
        id=1,
        cell_index=0,
        purpose="long_entry",
        side="buy",
        pos_side="long",
        price=102.0,
        quantity=1.0,
        client_order_id="c1",
        status="open",
    )
    broker.place_limit(order)
    assert broker.push_bar(bar("t1", low=103.0, high=110.0)) == []
    assert broker.push_bar(bar("t2", low=95.0, high=101.0)) == []
    assert order.filled_quantity == 0.0


def test_a_fill_prints_at_the_limit_price_not_the_bar_close() -> None:
    ledger = GridLedger()
    broker = SimulatedQuantBroker(ledger=ledger)
    order = GridRestingOrder(
        id=1,
        cell_index=0,
        purpose="long_entry",
        side="buy",
        pos_side="long",
        price=102.0,
        quantity=2.0,
        client_order_id="c1",
        status="open",
    )
    broker.place_limit(order)
    broker.push_bar(SimulatedBar(time="t", open=105.0, high=106.0, low=101.0, close=105.5))
    assert order.avg_fill_price == 102.0


# --------------------------------------------------------------------------
# 2. the crash-recovery watermark
# --------------------------------------------------------------------------


def test_processed_fill_qty_advances_only_after_the_ledger_write() -> None:
    """The crash window, made explicit.

    Between the venue reporting a fill and the ledger accepting it, the order
    must sit in `list_unprocessed()`. That is what a restart reads.
    """
    cfg = long_grid()
    engine, broker, ledger = build(cfg)
    engine.bootstrap(105.0)
    assert engine.sync_grid_orders(105.0) > 0

    resting = engine.orders.list_open(purpose="long_entry")
    target = max(resting, key=lambda order: order.price)
    broker.push_bar(bar("t1", low=target.price - 0.01, high=target.price + 0.01))

    # The venue has filled it. The ledger has NOT seen it.
    assert target.filled_quantity > 0
    assert target.processed_fill_qty == 0.0
    assert target in engine.orders.list_unprocessed()
    assert ledger.trades == []

    # === simulated crash: a brand-new engine over the SAME durable stores ===
    recovered = GridEngine(
        strategy_id=7,
        cfg=cfg,
        broker=broker,
        cells=engine.cells,
        orders=engine.orders,
        ledger=ledger,
        initial_capital=1000.0,
    )
    assert recovered.drain_unprocessed_fills() == 1
    assert len(ledger.trades) == 1
    assert target.processed_fill_qty == pytest.approx(target.filled_quantity)
    assert engine.orders.list_unprocessed() == []

    # Replaying recovery must not double-post.
    assert recovered.drain_unprocessed_fills() == 0
    assert len(ledger.trades) == 1


def test_the_recovery_query_uses_upstreams_epsilon() -> None:
    orders = GridRestingOrderStore()
    order = orders.insert(
        GridRestingOrder(cell_index=0, purpose="long_entry", price=100.0, quantity=1.0)
    )
    order.filled_quantity = 1.0
    order.processed_fill_qty = 1.0 - 1e-15  # inside the 1e-12 tolerance
    assert orders.list_unprocessed() == []
    order.processed_fill_qty = 1.0 - 1e-9  # outside it
    assert orders.list_unprocessed() == [order]


def test_a_fill_the_ledger_refuses_does_not_advance_the_watermark() -> None:
    """An unknown `purpose` maps to no signal. The order must stay recoverable
    rather than be silently marked processed."""
    ledger = GridLedger()
    cells = GridCellStore()
    order = GridRestingOrder(
        id=1, cell_index=0, purpose="mystery", price=100.0, quantity=1.0, filled_quantity=1.0
    )
    outcome = apply_grid_fill_to_local_state(ledger, cells, order, 1.0, 100.0)
    assert outcome.applied is False
    assert order.processed_fill_qty == 0.0
    assert ledger.trades == []


# --------------------------------------------------------------------------
# cell state machine
# --------------------------------------------------------------------------


def test_entry_fill_holds_the_cell_and_hangs_the_paired_exit() -> None:
    engine, broker, _ledger = build(long_grid())
    engine.bootstrap(105.0)
    engine.sync_grid_orders(105.0)
    entry = max(engine.orders.list_open(purpose="long_entry"), key=lambda o: o.price)
    cell_index = entry.cell_index

    broker.push_bar(bar("t1", low=entry.price - 0.01, high=entry.price + 0.01))
    engine.drain_unprocessed_fills()

    cell = engine.cells.get(cell_index)
    assert cell is not None
    assert cell.state == GridCellState.LONG_HELD
    assert cell.leg_size == pytest.approx(entry.quantity)
    assert cell.leg_entry_price == pytest.approx(entry.price)
    exits = engine.orders.list_open(purpose="long_exit", cell_index=cell_index)
    assert len(exits) == 1
    assert exits[0].reduce_only is True
    assert exits[0].price == pytest.approx(cell.upper_price)


def test_exit_fill_frees_the_cell_and_re_hangs_the_entry_at_the_sold_quantity() -> None:
    engine, broker, ledger = build(long_grid())
    engine.bootstrap(105.0)
    engine.sync_grid_orders(105.0)
    entry = max(engine.orders.list_open(purpose="long_entry"), key=lambda o: o.price)
    cell_index = entry.cell_index
    sold_qty = entry.quantity

    broker.push_bar(bar("t1", low=entry.price - 0.01, high=entry.price + 0.01))
    engine.drain_unprocessed_fills()
    exit_order = engine.orders.list_open(purpose="long_exit", cell_index=cell_index)[0]

    broker.push_bar(bar("t2", low=exit_order.price - 0.01, high=exit_order.price + 0.01))
    engine.drain_unprocessed_fills()

    cell = engine.cells.get(cell_index)
    assert cell is not None
    # Freed and re-armed within the same fill: the cell goes IDLE, then the
    # replacement entry immediately writes BUY_OPEN back onto it.
    assert cell.state == GridCellState.BUY_OPEN
    re_hung = engine.orders.list_open(purpose="long_entry", cell_index=cell_index)
    assert len(re_hung) == 1
    assert re_hung[0].quantity == pytest.approx(sold_qty)
    assert re_hung[0].price == pytest.approx(entry.price)
    # One completed round trip, priced off the cell's own two rungs.
    assert ledger.matched_cycle_count == 1
    matched = [t for t in ledger.trades if t.grid_matched_profit is not None][0]
    assert matched.grid_matched_profit == pytest.approx(
        (exit_order.price - entry.price) * sold_qty
    )


def test_cell_pnl_overrides_the_fifo_answer() -> None:
    """Two entries at different prices, then one cell's exit. The trade books
    the CELL's basis, not the blended position average."""
    ledger = GridLedger()
    cells = GridCellStore()
    levels = generate_levels(100.0, 110.0, 6, "arithmetic")
    cells.bootstrap_idle_cells(generate_cells(levels))
    # Position built at a blended average of 101 and 105.
    ledger.apply_fill_to_local_position("open_long", 1.0, 101.0)
    ledger.apply_fill_to_local_position("open_long", 1.0, 105.0)
    assert ledger.positions["long"].entry_price == pytest.approx(103.0)

    cells.set_state(0, GridCellState.LONG_HELD, leg_size=1.0, leg_entry_price=101.0)
    exit_order = GridRestingOrder(
        id=1, cell_index=0, purpose="long_exit", price=102.0, quantity=1.0, reduce_only=True
    )
    outcome = apply_grid_fill_to_local_state(ledger, cells, exit_order, 1.0, 102.0)
    assert outcome.profit == pytest.approx(1.0)  # (102 - 101) * 1, not (102 - 103)
    assert outcome.matched_entry_price == pytest.approx(101.0)


def test_a_cell_with_no_recorded_basis_falls_back_to_its_own_rung() -> None:
    ledger = GridLedger()
    cells = GridCellStore()
    cells.bootstrap_idle_cells(generate_cells(generate_levels(100.0, 110.0, 6, "arithmetic")))
    ledger.apply_fill_to_local_position("open_long", 1.0, 100.0)
    exit_order = GridRestingOrder(
        id=1, cell_index=0, purpose="long_exit", price=102.0, quantity=1.0, reduce_only=True
    )
    outcome = apply_grid_fill_to_local_state(ledger, cells, exit_order, 1.0, 102.0)
    cell = cells.get(0)
    assert cell is not None
    assert outcome.matched_entry_price == pytest.approx(cell.lower_price)


def test_entries_never_land_on_a_cell_that_already_has_working_orders() -> None:
    engine, _broker, _ledger = build(long_grid())
    engine.bootstrap(105.0)
    first = engine.sync_grid_orders(105.0)
    assert first > 0
    # Nothing has filled, so every eligible cell is already armed.
    assert engine.sync_grid_orders(105.0) == 0


def test_max_open_orders_caps_the_armed_ladder() -> None:
    engine, _broker, _ledger = build(long_grid(gridCount=11, maxOpenOrders=2))
    engine.bootstrap(109.0)
    assert engine.sync_grid_orders(109.0) == 2
    assert len(engine.orders.list_open(purpose="long_entry")) == 2


def test_neutral_grid_alternates_legs_nearest_first() -> None:
    cfg = GridBotConfig.from_trading_config(
        {
            "market_type": "swap",
            "bot_params": {
                "lowerPrice": 100.0,
                "upperPrice": 110.0,
                "gridCount": 11,
                "amountPerGrid": 100.0,
                "gridDirection": "neutral",
                "maxOpenOrders": 4,
            },
        }
    )
    engine, _broker, _ledger = build(cfg)
    engine.bootstrap(105.0)
    assert engine.sync_grid_orders(105.0) == 4
    placed = sorted(engine.orders.list_open(), key=lambda order: order.id)
    purposes = [order.purpose for order in placed]
    # Fair allocation: two per leg, long served first on the tie.
    assert purposes == ["long_entry", "short_entry", "long_entry", "short_entry"]
    # Nearest rungs first on both legs.
    longs = [order.price for order in placed if order.purpose == "long_entry"]
    shorts = [order.price for order in placed if order.purpose == "short_entry"]
    assert longs == sorted(longs, reverse=True)
    assert shorts == sorted(shorts)


def test_short_grid_arms_sells_above_the_price() -> None:
    cfg = GridBotConfig.from_trading_config(
        {
            "market_type": "swap",
            "bot_params": {
                "lowerPrice": 100.0,
                "upperPrice": 110.0,
                "gridCount": 6,
                "amountPerGrid": 100.0,
                "gridDirection": "short",
            },
        }
    )
    engine, _broker, _ledger = build(cfg)
    engine.bootstrap(102.0)
    assert engine.sync_grid_orders(102.0) > 0
    orders = engine.orders.list_open(purpose="short_entry")
    assert orders
    assert all(order.side == "sell" and order.price > 102.0 for order in orders)


def test_held_cells_get_their_exits_re_hung_after_a_restart() -> None:
    engine, broker, ledger = build(long_grid())
    engine.bootstrap(105.0)
    engine.sync_grid_orders(105.0)
    entry = max(engine.orders.list_open(purpose="long_entry"), key=lambda o: o.price)
    broker.push_bar(bar("t1", low=entry.price - 0.01, high=entry.price + 0.01))
    engine.drain_unprocessed_fills()

    # Kill every working order the way a shutdown does, but keep the inventory.
    engine.shutdown()
    cell = engine.cells.get(entry.cell_index)
    assert cell is not None
    assert cell.state == GridCellState.LONG_HELD
    assert engine.orders.list_open(purpose="long_exit") == []

    restarted = GridEngine(
        strategy_id=7,
        cfg=engine.cfg,
        broker=broker,
        cells=engine.cells,
        orders=engine.orders,
        ledger=ledger,
        initial_capital=1000.0,
    )
    restarted.bootstrap(105.0)
    assert restarted.sync_held_cell_exits(105.0) == 1
    assert len(restarted.orders.list_open(purpose="long_exit")) == 1


def test_shutdown_preserves_held_state_but_clears_working_ones() -> None:
    cells = GridCellStore()
    cells.bootstrap_idle_cells(generate_cells(generate_levels(100.0, 110.0, 3, "arithmetic")))
    cells.set_state(0, GridCellState.BUY_OPEN, leg_size=5.0, leg_entry_price=101.0)
    cells.set_state(1, GridCellState.LONG_HELD, leg_size=4.0, leg_entry_price=102.0)
    cells.release_cancelled_working_orders()
    working = cells.get(0)
    held = cells.get(1)
    assert working is not None and held is not None
    assert working.state == GridCellState.IDLE
    assert working.leg_size == 0.0
    assert held.state == GridCellState.LONG_HELD
    assert held.leg_size == 4.0
    assert held.leg_entry_price == 102.0


# --------------------------------------------------------------------------
# boundary
# --------------------------------------------------------------------------


def test_boundary_pause_cancels_entries_and_stops_arming() -> None:
    engine, _broker, _ledger = build(long_grid(boundaryAction="pause"))
    engine.bootstrap(105.0)
    engine.sync_grid_orders(105.0)
    assert engine.handle_boundary(95.0) is True
    assert engine.entries_paused is True
    assert engine.orders.list_open(purpose="long_entry") == []
    assert engine.sync_grid_orders(105.0) == 0
    assert engine.stop_requested is False


def test_boundary_hold_warns_and_leaves_orders_alone() -> None:
    engine, _broker, _ledger = build(long_grid(boundaryAction="hold"))
    engine.bootstrap(105.0)
    engine.sync_grid_orders(105.0)
    before = len(engine.orders.list_open(purpose="long_entry"))
    assert engine.handle_boundary(95.0) is True
    assert engine.entries_paused is False
    assert len(engine.orders.list_open(purpose="long_entry")) == before
    assert any("out of bounds (hold)" in message for _level, message in engine.logs)


def test_boundary_stop_loss_closes_everything_and_requests_a_stop() -> None:
    engine, broker, ledger = build(long_grid(boundaryAction="stop_loss"))
    engine.bootstrap(105.0)
    engine.sync_grid_orders(105.0)
    entry = max(engine.orders.list_open(purpose="long_entry"), key=lambda o: o.price)
    broker.push_bar(bar("t1", low=entry.price - 0.01, high=entry.price + 0.01))
    engine.drain_unprocessed_fills()
    assert ledger.leg_position_qty("long") > 0

    assert engine.handle_boundary(95.0) is True
    assert engine.stop_requested is True
    assert "stop_loss requested" in engine.stop_reason
    assert ledger.leg_position_qty("long") == 0.0
    assert any(trade.close_reason == "grid_boundary_stop" for trade in ledger.trades)


def test_a_price_inside_the_band_never_triggers() -> None:
    engine, _broker, _ledger = build(long_grid())
    engine.bootstrap(105.0)
    assert engine.handle_boundary(105.0) is False
    # A long grid ignores the UPPER breach; only the lower bound matters to it.
    assert engine.handle_boundary(120.0) is False


# --------------------------------------------------------------------------
# sizing, ids, and the whole-run driver
# --------------------------------------------------------------------------


def test_base_quantity_is_budget_times_leverage_over_price() -> None:
    cfg = GridBotConfig.from_trading_config(
        {
            "market_type": "swap",
            "leverage": 20,
            "bot_params": {
                "lowerPrice": 100.0,
                "upperPrice": 110.0,
                "amountPerGrid": 4.0,
                "gridDirection": "long",
            },
        }
    )
    engine, _broker, _ledger = build(cfg)
    # Floored onto the default 8-dp precision, never rounded up.
    assert engine.grid_base_qty(72710.0) == pytest.approx(0.00110026)
    assert engine.grid_base_qty(72710.0) <= 4 * 20 / 72710


def test_spot_ignores_leverage() -> None:
    cfg = GridBotConfig.from_trading_config(
        {
            "market_type": "spot",
            "leverage": 20,
            "bot_params": {"lowerPrice": 100.0, "upperPrice": 110.0, "amountPerGrid": 4.0},
        }
    )
    engine, _broker, _ledger = build(cfg)
    assert engine.grid_base_qty(100.0) == pytest.approx(0.04)


def test_initial_market_leg_is_capital_times_pct() -> None:
    engine, _broker, ledger = build(long_grid(initialPositionPct=20))
    engine.bootstrap(105.0)
    assert engine.target_initial_usdt() == pytest.approx(200.0)
    assert engine.run_initial_market_position(105.0) is True
    assert ledger.leg_position_qty("long") == pytest.approx(200.0 / 105.0)
    # Idempotent: a second call is a no-op, not a second position.
    assert engine.run_initial_market_position(105.0) is True
    assert ledger.leg_position_qty("long") == pytest.approx(200.0 / 105.0)


def test_neutral_initial_leg_splits_the_notional_across_both_legs() -> None:
    cfg = GridBotConfig.from_trading_config(
        {
            "market_type": "swap",
            "bot_params": {
                "lowerPrice": 100.0,
                "upperPrice": 110.0,
                "amountPerGrid": 100.0,
                "gridDirection": "neutral",
                "initialPositionPct": 20,
            },
        }
    )
    engine, _broker, ledger = build(cfg)
    # sanitize_grid_bot_params zeroes a neutral grid's initial position, so the
    # config-level pct is 0 and no market leg is opened at all.
    assert cfg.initial_position_pct == 0.0
    assert engine.run_initial_market_position(105.0) is True
    assert ledger.positions == {}


def test_initial_client_order_id_is_deterministic_per_leg() -> None:
    assert make_grid_initial_client_order_id(42, "l") == make_grid_initial_client_order_id(42, "l")
    assert make_grid_initial_client_order_id(42, "l") != make_grid_initial_client_order_id(42, "s")
    assert make_grid_initial_client_order_id(42, "x") == make_grid_initial_client_order_id(42, "")
    assert len(make_grid_initial_client_order_id(999999999, "l")) <= 32


def test_resting_client_order_ids_encode_purpose_and_stay_short() -> None:
    assert make_grid_client_order_id(12, 3, "long_entry", 1)[-6] == "e"
    assert make_grid_client_order_id(12, 3, "long_exit", 1)[-6] == "x"
    assert make_grid_client_order_id(12, 3, "short_entry", 1)[-6] == "s"
    assert make_grid_client_order_id(12, 3, "short_exit", 1)[-6] == "c"
    assert len(make_grid_client_order_id(99999, 999, "long_entry", 999999)) <= 32
    # Deterministic given the same seq, distinct across seqs.
    assert make_grid_client_order_id(1, 1, "long_entry", 5) == make_grid_client_order_id(
        1, 1, "long_entry", 5
    )
    assert make_grid_client_order_id(1, 1, "long_entry", 5) != make_grid_client_order_id(
        1, 1, "long_entry", 6
    )


def test_quantity_is_floored_onto_the_lot_step_never_rounded_up() -> None:
    spec = SymbolSpec(lot_step=0.1, min_quantity=0.1)
    assert spec.floor_quantity(0.19) == pytest.approx(0.1)
    assert spec.floor_quantity(0.3) == pytest.approx(0.3)
    assert spec.floor_quantity(0.05) == 0.0  # below the minimum
    # Total: no input makes it raise.
    assert spec.floor_quantity(float("nan")) == 0.0
    assert spec.floor_quantity(-5.0) == 0.0
    assert SymbolSpec().floor_quantity(1.2345678901) == pytest.approx(1.2345679)


def test_a_full_replay_reports_only_simulated_numbers() -> None:
    cfg = long_grid(gridCount=6, amountPerGrid=100.0)
    bars = [
        bar("2026-01-01T00:00:00+00:00", low=104.0, high=106.0, close=105.0),
        bar("2026-01-01T01:00:00+00:00", low=101.0, high=105.0, close=102.0),
        bar("2026-01-01T02:00:00+00:00", low=101.5, high=109.0, close=108.0),
        bar("2026-01-01T03:00:00+00:00", low=103.0, high=108.5, close=104.0),
    ]
    result = run_grid_simulation(
        strategy_id=3, cfg=cfg, bars=bars, initial_capital=1000.0, fee_rate=0.001
    )
    assert result.ok is True
    assert result.execution_mode == "simulation"
    assert result.bar_count == 4
    assert result.fill_count > 0
    assert result.matched_cycles >= 1
    assert result.total_commission > 0
    assert result.ending_price == 104.0
    assert all(entry["level"] in {"info", "warning", "error"} for entry in result.logs)


def test_a_rejected_config_reports_the_rejection_and_runs_nothing() -> None:
    result = run_grid_simulation(
        strategy_id=3,
        cfg=long_grid(lowerPrice=100.0, upperPrice=100.5, gridCount=11),
        bars=[bar("t", low=100.0, high=100.5)],
        initial_capital=1000.0,
    )
    assert result.ok is False
    assert result.error.startswith("Grid spacing is too narrow after fees")
    assert result.fill_count == 0
    assert result.trades == []


def test_no_bars_is_an_error_not_an_empty_success() -> None:
    result = run_grid_simulation(strategy_id=3, cfg=long_grid(), bars=[], initial_capital=1000.0)
    assert result.ok is False
    assert result.error == "at least one bar is required to simulate a grid"
