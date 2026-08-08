"""Hand-verified coverage for `simulate_trades`: every bar in these fixtures
is constructed so the stop/target outcome (and therefore the exact expected
`r_multiple`) is known ahead of time and checked by hand below, not just
"it ran without crashing"."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.engine.backtest.simulate import simulate_trades
from app.engine.strategies.base import Direction, Signal
from app.storage.models import Bar


def _bar(index: int, *, open_: float, high: float, low: float, close: float) -> Bar:
    moment = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(minutes=15 * index)
    return Bar(time=moment.isoformat(), open=open_, high=high, low=low, close=close, volume=1000.0)


def _signal(
    *, direction: Direction = "buy", entry: float = 100.0, stop_loss: float, target: float
) -> Signal:
    return Signal(
        strategy_id="test_strategy",
        strategy_version="1.0.0",
        direction=direction,
        plan_type="immediate",
        entry=entry,
        stop_loss=stop_loss,
        take_profit=target,
        targets=[target],
        confidence=0.5,
        regime="trend",
        rationale=[],
        evidence={},
    )


def test_simulate_trades_buy_target_stop_tie_and_unresolved_are_all_correct() -> None:
    """Four buy signals, entry=100/stop=95/target=110 (risk=5) each, each
    firing on bars 0/2/4/6 with a hand-crafted resolution bar right after:
      - bar 1: only the target's range is touched -> WIN,  r = (110-100)/5 = +2.0
      - bar 3: only the stop's range is touched   -> LOSS, r = (95-100)/5  = -1.0
      - bar 5: BOTH ranges touched in one bar     -> conservative tie-break to
        the stop (the worse outcome), r = -1.0, never the target's +2.0
      - bar 7 (last bar): neither range touched -> the signal never resolves
        and must be EXCLUDED from the output entirely (not force-closed).
    """
    stop_loss, target = 95.0, 110.0
    signal = _signal(stop_loss=stop_loss, target=target)

    bars = [
        _bar(0, open_=100.0, high=100.5, low=99.5, close=100.0),  # entry bar for signal @0
        _bar(1, open_=105.0, high=111.0, low=101.0, close=106.0),  # target only
        _bar(2, open_=100.0, high=100.5, low=99.5, close=100.0),  # entry bar for signal @2
        _bar(3, open_=96.0, high=101.0, low=90.0, close=97.0),  # stop only
        _bar(4, open_=100.0, high=100.5, low=99.5, close=100.0),  # entry bar for signal @4
        _bar(5, open_=100.0, high=115.0, low=90.0, close=102.0),  # both -> tie-break to stop
        _bar(6, open_=100.0, high=100.5, low=99.5, close=100.0),  # entry bar for signal @6
        _bar(7, open_=100.0, high=105.0, low=96.0, close=101.0),  # neither -> unresolved
    ]
    fired = [(0, signal), (2, signal), (4, signal), (6, signal)]

    trades = simulate_trades(fired, bars)

    assert len(trades) == 3  # the 4th (unresolved) signal is excluded, not force-closed
    win, loss, tie = trades

    assert win.entry_step_index == 0 and win.exit_step_index == 1
    assert win.outcome == "target"
    assert win.exit_price == target
    assert win.r_multiple == 2.0

    assert loss.entry_step_index == 2 and loss.exit_step_index == 3
    assert loss.outcome == "stop"
    assert loss.exit_price == stop_loss
    assert loss.r_multiple == -1.0

    assert tie.entry_step_index == 4 and tie.exit_step_index == 5
    assert tie.outcome == "stop"  # conservative tie-break, never "target"
    assert tie.exit_price == stop_loss
    assert tie.r_multiple == -1.0


def test_simulate_trades_sell_direction_resolves_with_correctly_signed_r_multiple() -> None:
    """entry=100, stop=105, target=90 (a sell): a bar whose LOW touches the
    target is a win (+2.0), a bar whose HIGH touches the stop is a loss
    (-1.0) -- mirrored logic from the buy case, checked independently."""
    stop_loss, target = 105.0, 90.0
    win_signal = _signal(direction="sell", stop_loss=stop_loss, target=target)
    loss_signal = _signal(direction="sell", stop_loss=stop_loss, target=target)

    bars = [
        _bar(0, open_=100.0, high=100.5, low=99.5, close=100.0),  # entry bar for win signal @0
        _bar(1, open_=95.0, high=101.0, low=89.0, close=91.0),  # target only (low<=90)
        _bar(2, open_=100.0, high=100.5, low=99.5, close=100.0),  # entry bar for loss signal @2
        _bar(3, open_=101.0, high=106.0, low=99.0, close=102.0),  # stop only (high>=105)
    ]
    fired = [(0, win_signal), (2, loss_signal)]

    trades = simulate_trades(fired, bars)

    assert len(trades) == 2
    win, loss = trades
    assert win.outcome == "target"
    assert win.exit_price == target
    assert win.r_multiple == 2.0
    assert loss.outcome == "stop"
    assert loss.exit_price == stop_loss
    assert loss.r_multiple == -1.0


def test_simulate_trades_skips_signal_with_no_entry_or_no_targets() -> None:
    no_entry = Signal(
        strategy_id="s",
        strategy_version="1.0.0",
        direction="buy",
        plan_type="conditional",
        entry=None,
        stop_loss=95.0,
        take_profit=110.0,
        targets=[110.0],
        confidence=0.5,
        regime="trend",
        rationale=[],
        evidence={},
    )
    no_targets = Signal(
        strategy_id="s",
        strategy_version="1.0.0",
        direction="buy",
        plan_type="immediate",
        entry=100.0,
        stop_loss=95.0,
        take_profit=None,
        targets=[],
        confidence=0.5,
        regime="trend",
        rationale=[],
        evidence={},
    )
    bars = [
        _bar(0, open_=100.0, high=100.5, low=99.5, close=100.0),
        _bar(1, open_=100.0, high=200.0, low=1.0, close=100.0),
    ]
    trades = simulate_trades([(0, no_entry), (0, no_targets)], bars)
    assert trades == []
