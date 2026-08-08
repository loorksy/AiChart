"""Trade-level backtest statistics computed purely from `SimulatedTrade`
R-multiples -- no currency, no account equity, no leverage model (see
`app/engine/backtest/simulate.py`'s module docstring for why). Every metric
that cannot be computed for a degenerate trade list (empty, no losing
trades, fewer than 2 trades, zero variance) is `None`, with the reason
recorded in `metric_reasons` rather than silently defaulting to 0 or NaN."""

from __future__ import annotations

import statistics

from app.engine.backtest.models import BacktestMetrics, SimulatedTrade

_NO_TRADES_REASON = "no resolved trades"


def calculate_backtest_metrics(trades: list[SimulatedTrade]) -> BacktestMetrics:
    trade_count = len(trades)
    if trade_count == 0:
        return BacktestMetrics(
            trade_count=0,
            metric_reasons={
                "win_rate": _NO_TRADES_REASON,
                "profit_factor": _NO_TRADES_REASON,
                "expectancy_r": _NO_TRADES_REASON,
                "max_drawdown_r": _NO_TRADES_REASON,
                "max_drawdown_percent": _NO_TRADES_REASON,
                "sharpe_r": _NO_TRADES_REASON,
            },
        )

    reasons: dict[str, str] = {}
    r_values = [trade.r_multiple for trade in trades]
    wins = [r for r in r_values if r > 0]
    losses = [r for r in r_values if r < 0]

    win_rate = len(wins) / trade_count

    profit_factor: float | None
    if losses:
        gross_profit_r = sum(wins)
        gross_loss_r = sum(losses)
        profit_factor = gross_profit_r / abs(gross_loss_r)
    else:
        profit_factor = None
        reasons["profit_factor"] = "no losing trades"

    expectancy_r = sum(r_values) / trade_count

    max_drawdown_r, max_drawdown_percent, drawdown_reason = _max_drawdown(r_values)
    if drawdown_reason is not None:
        reasons["max_drawdown_percent"] = drawdown_reason

    sharpe_r: float | None
    if trade_count < 2:
        sharpe_r = None
        reasons["sharpe_r"] = "fewer than 2 trades"
    else:
        # Simplified Sharpe: mean(r) / population-stdev(r) over trade-level
        # R-returns. This is NOT time-annualized and does not account for
        # trade holding period or trade frequency -- an approximation only,
        # not a like-for-like comparison with a conventional annualized
        # Sharpe ratio.
        stdev = statistics.pstdev(r_values)
        if stdev == 0:
            sharpe_r = None
            reasons["sharpe_r"] = "zero variance in trade R-returns"
        else:
            sharpe_r = statistics.mean(r_values) / stdev

    return BacktestMetrics(
        trade_count=trade_count,
        win_rate=win_rate,
        profit_factor=profit_factor,
        expectancy_r=expectancy_r,
        max_drawdown_r=max_drawdown_r,
        max_drawdown_percent=max_drawdown_percent,
        sharpe_r=sharpe_r,
        metric_reasons=reasons,
    )


def _max_drawdown(r_values: list[float]) -> tuple[float, float | None, str | None]:
    """Peak-to-trough drawdown on the CUMULATIVE R curve, starting from a
    baseline of 0 (before the first trade). `max_drawdown_percent` expresses
    the drawdown as a percent (0-100 scale) of the running peak --
    deliberately currency-free, a documented divergence from an
    account-equity-based drawdown. If the cumulative curve never rises above
    0 (every trade a loss from the start), the peak stays 0 and "percent of
    peak" is undefined -- `None` with a reason, not a division by zero."""
    cumulative = 0.0
    peak = 0.0
    max_drawdown_r = 0.0
    max_drawdown_percent = 0.0
    ever_above_zero = False
    for r in r_values:
        cumulative += r
        peak = max(peak, cumulative)
        drawdown_r = peak - cumulative
        max_drawdown_r = max(max_drawdown_r, drawdown_r)
        if peak > 0:
            ever_above_zero = True
            max_drawdown_percent = max(max_drawdown_percent, drawdown_r / peak * 100)
    if not ever_above_zero:
        return max_drawdown_r, None, "cumulative R never rose above zero"
    return max_drawdown_r, max_drawdown_percent, None
