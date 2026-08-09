"""`run_backtest` is thin glue (replay -> simulate -> metrics) -- these
tests check the glue actually wires through correctly end to end, using the
same known-outcome style as the lower-level replay/simulate/metrics tests."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.engine.backtest.run import run_backtest
from app.engine.features import compute_features
from app.engine.strategies.ema_trend_v1 import EmaTrendV1
from app.storage.models import Bar
from tests.fixtures import bars_triggering_ema_trend_buy


def _bars() -> list[Bar]:
    return [Bar.model_validate(raw) for raw in bars_triggering_ema_trend_buy()]


def test_run_backtest_reports_an_unresolved_fired_signal_as_zero_trades() -> None:
    """The fixture is tuned to fire exactly on its LAST bar (see
    tests/fixtures.py), so there are no subsequent bars to resolve the
    trade -- it must be excluded from trades/metrics, never force-closed."""
    bars = _bars()
    outcome = run_backtest(EmaTrendV1(), "EURUSD", "forex", "M15", bars, min_bars=210)

    assert outcome.fired_count == 1
    assert outcome.trades == []
    assert outcome.metrics.trade_count == 0
    assert outcome.metrics.metric_reasons["win_rate"] == "no resolved trades"


def test_run_backtest_resolves_a_trade_when_a_target_bar_follows() -> None:
    bars = _bars()
    strategy = EmaTrendV1()
    features = compute_features("EURUSD", "forex", "M15", bars)
    signal = strategy.evaluate(features)
    assert signal is not None
    assert signal.direction == "buy"
    assert signal.entry is not None

    entry = signal.entry
    target = signal.targets[0]
    extra_time = datetime.fromisoformat(bars[-1].time.replace("Z", "+00:00")) + timedelta(
        minutes=15
    )
    extra_bar = Bar(
        time=extra_time.isoformat(),
        open=entry,
        high=target + 0.001,
        low=entry,
        close=target,
        volume=1000.0,
    )

    outcome = run_backtest(strategy, "EURUSD", "forex", "M15", [*bars, extra_bar], min_bars=210)

    assert outcome.fired_count == 1
    assert len(outcome.trades) == 1
    trade = outcome.trades[0]
    assert trade.outcome == "target"
    # target[0] is exactly 1R away by construction (the R-multiple ladder's
    # first rung) -- hitting it exactly should read back as r_multiple==1.0.
    assert trade.r_multiple == 1.0
    assert outcome.metrics.trade_count == 1
    assert outcome.metrics.win_rate == 1.0
    assert outcome.metrics.expectancy_r == 1.0
