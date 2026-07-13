from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.backtest.execution import ExecutionCosts, executable_fill
from app.backtest.models import (
    IntrabarPolicy,
    Order,
    OrderStatus,
    OrderType,
    Position,
    Side,
    Target,
)
from app.backtest.orders import expire_order, order_trigger_reference
from app.backtest.policies import symbol_metadata
from app.backtest.positions import resolve_entry_bar, resolve_intrabar, tighten_stop


def costs(spread: float = 2.0) -> ExecutionCosts:
    return ExecutionCosts(
        "fixed_pips",
        spread,
        (),
        "none",
        0,
        "normal",
        0,
        0,
        0,
        "none",
        0,
        "none",
        0,
    )


def test_long_and_short_pay_half_spread_on_each_executable_side() -> None:
    import random

    bar = SimpleNamespace(open=1.0, timestamp=datetime(2026, 1, 1, tzinfo=UTC))
    meta = symbol_metadata("EURUSD")
    rng = random.Random(42)  # noqa: S311 - deterministic simulation fixture
    long_entry = executable_fill(bar, Side.LONG, "entry", 1.0, meta, costs(), rng)
    long_exit = executable_fill(bar, Side.LONG, "exit", 1.0, meta, costs(), rng)
    short_entry = executable_fill(bar, Side.SHORT, "entry", 1.0, meta, costs(), rng)
    short_exit = executable_fill(bar, Side.SHORT, "exit", 1.0, meta, costs(), rng)
    assert long_entry.price == pytest.approx(1.0001)
    assert long_exit.price == pytest.approx(0.9999)
    assert short_entry.price == pytest.approx(0.9999)
    assert short_exit.price == pytest.approx(1.0001)


def position(side: Side) -> Position:
    return Position(
        "pos",
        "trade",
        "EURUSD",
        side,
        datetime(2026, 1, 1, tzinfo=UTC),
        1,
        1.0,
        1.0,
        1.0,
        1.0,
        0.99 if side == Side.LONG else 1.01,
        0.99 if side == Side.LONG else 1.01,
        [Target(1.01 if side == Side.LONG else 0.99, 1.0, "TP1")],
        0.01,
    )


@pytest.mark.parametrize(
    ("policy", "stop", "target", "rejected"),
    [
        (IntrabarPolicy.WORST_CASE, True, (), False),
        (IntrabarPolicy.STOP_FIRST, True, (), False),
        (IntrabarPolicy.BEST_CASE, False, (0,), False),
        (IntrabarPolicy.TARGET_FIRST, False, (0,), False),
        (IntrabarPolicy.REJECT_AMBIGUOUS, False, (), True),
    ],
)
def test_same_bar_policy_is_explicit(policy, stop, target, rejected) -> None:
    bar = SimpleNamespace(open=1.0, high=1.02, low=0.98, close=1.01)
    decision = resolve_intrabar(position(Side.LONG), bar, policy)
    assert decision.ambiguous
    assert decision.stop_hit is stop
    assert decision.target_indices == target
    assert decision.rejected is rejected


def test_short_ambiguity_and_trailing_only_tightens() -> None:
    item = position(Side.SHORT)
    bar = SimpleNamespace(open=1.0, high=1.02, low=0.98, close=0.99)
    assert resolve_intrabar(item, bar, IntrabarPolicy.WORST_CASE).stop_hit
    assert tighten_stop(item, 1.005)
    item.pending_stop = None
    item.current_stop = 1.005
    assert not tighten_stop(item, 1.02)


def test_stop_gap_through_and_limit_fill_policies_are_conservative() -> None:
    base = dict(
        order_id="ord",
        symbol="EURUSD",
        side=Side.LONG,
        created_index=0,
        activation_index=1,
        expiry_index=2,
        reference_price=1.0,
        size_lots=0.1,
        stop_price=0.99,
        target_prices=[Target(1.02, 1.0, "TP1")],
        signal_time=datetime(2026, 1, 1, tzinfo=UTC),
    )
    stop = Order(
        **base,
        order_type=OrderType.STOP,
        requested_price=1.01,
    )
    gap_bar = SimpleNamespace(open=1.02, high=1.03, low=1.019)
    assert order_trigger_reference(stop, gap_bar) == pytest.approx(1.02)

    limit = Order(
        **base,
        order_type=OrderType.LIMIT,
        requested_price=0.99,
    )
    favorable_gap = SimpleNamespace(open=0.98, high=1.0, low=0.97)
    assert order_trigger_reference(limit, favorable_gap) == pytest.approx(0.99)
    assert not expire_order(limit, 2)
    assert expire_order(limit, 3)
    assert limit.status == OrderStatus.EXPIRED


def test_zero_spread_policy_does_not_require_a_spread_column() -> None:
    import random

    zero_costs = ExecutionCosts("none", 0, (), "none", 0, "normal", 0, 0, 0, "none", 0, "none", 0)
    bar = SimpleNamespace(open=1.0, timestamp=datetime(2026, 1, 1, tzinfo=UTC))
    fill = executable_fill(
        bar,
        Side.LONG,
        "entry",
        1.0,
        symbol_metadata("EURUSD"),
        zero_costs,
        random.Random(1),  # noqa: S311 - deterministic simulation fixture
    )
    assert fill.price == 1.0
    assert fill.spread_cost_price == 0.0


@pytest.mark.parametrize(
    ("policy", "targets", "stop_first", "stop_after", "rejected"),
    [
        (IntrabarPolicy.WORST_CASE, (0,), False, True, False),
        (IntrabarPolicy.BEST_CASE, (0,), False, False, False),
        (IntrabarPolicy.STOP_FIRST, (), True, False, False),
        (IntrabarPolicy.TARGET_FIRST, (0,), False, True, False),
        (IntrabarPolicy.OHLC_PATH, (0,), False, False, False),
        (IntrabarPolicy.REJECT_AMBIGUOUS, (), False, False, True),
    ],
)
def test_pending_entry_same_bar_ordering_uses_every_intrabar_policy(
    policy: IntrabarPolicy,
    targets: tuple[int, ...],
    stop_first: bool,
    stop_after: bool,
    rejected: bool,
) -> None:
    item = position(Side.LONG)
    item.entry_order_type = OrderType.STOP
    item.entry_requested_price = 1.0
    item.reference_entry_price = 1.0
    item.current_stop = 0.99
    item.initial_stop = 0.99
    item.targets = [Target(1.01, 0.5, "TP1")]
    bar = SimpleNamespace(open=0.995, high=1.02, low=0.98, close=1.005)
    decision = resolve_entry_bar(item, bar, policy)
    assert decision.ambiguous
    assert decision.target_indices == targets
    assert decision.stop_hit is stop_first
    assert decision.stop_after_targets is stop_after
    assert decision.rejected is rejected
