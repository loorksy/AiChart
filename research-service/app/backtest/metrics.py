from __future__ import annotations

import math
import statistics
from collections import defaultdict
from typing import Any

from .models import EquityPoint, Side, Trade
from .policies import annual_periods


def _streaks(values: list[bool]) -> tuple[int, int]:
    best_win = best_loss = current_win = current_loss = 0
    for won in values:
        current_win = current_win + 1 if won else 0
        current_loss = 0 if won else current_loss + 1
        best_win = max(best_win, current_win)
        best_loss = max(best_loss, current_loss)
    return best_win, best_loss


def _breakdown(trades: list[Trade], key: str) -> dict[str, dict[str, float | int]]:
    groups: dict[str, list[Trade]] = defaultdict(list)
    for trade in trades:
        value = getattr(trade, key)
        groups[str(value.value if isinstance(value, Side) else value or "unknown")].append(trade)
    return {
        name: {
            "trade_count": len(items),
            "net_profit": round(sum(item.net_pnl for item in items), 8),
            "win_rate": round(sum(item.net_pnl > 0 for item in items) / len(items), 8),
        }
        for name, items in sorted(groups.items())
    }


def calculate_metrics(
    trades: list[Trade],
    equity: list[EquityPoint],
    initial_capital: float,
    timeframe: str,
) -> dict[str, Any]:
    reasons: dict[str, str] = {}
    pnls = [trade.net_pnl for trade in trades]
    wins = [value for value in pnls if value > 0]
    losses = [value for value in pnls if value < 0]
    gross_profit = sum(wins)
    gross_loss = sum(losses)
    net_profit = sum(pnls)
    trade_count = len(trades)
    if not losses:
        profit_factor = None
        reasons["profit_factor"] = "no losing trades"
    else:
        profit_factor = gross_profit / abs(gross_loss)
    r_values = [trade.r_multiple for trade in trades if trade.r_multiple is not None]
    average_r = statistics.fmean(r_values) if r_values else None
    median_r = statistics.median(r_values) if r_values else None
    if not r_values:
        reasons["average_r"] = reasons["median_r"] = "no trades with defined initial risk"

    equity_values = [point.equity for point in equity]
    returns = [
        equity_values[index] / equity_values[index - 1] - 1
        for index in range(1, len(equity_values))
        if equity_values[index - 1] > 0
    ]
    if len(returns) < 2 or statistics.pstdev(returns) == 0:
        sharpe = None
        reasons["sharpe_ratio"] = "at least two non-constant equity returns are required"
    else:
        sharpe = (
            statistics.fmean(returns)
            / statistics.pstdev(returns)
            * math.sqrt(annual_periods(timeframe))
        )
    downside = [value for value in returns if value < 0]
    if len(downside) < 2 or statistics.pstdev(downside) == 0:
        sortino = None
        reasons["sortino_ratio"] = "at least two non-constant negative returns are required"
    else:
        sortino = (
            statistics.fmean(returns)
            / statistics.pstdev(downside)
            * math.sqrt(annual_periods(timeframe))
        )

    max_drawdown = max((point.drawdown for point in equity), default=0.0)
    max_drawdown_percent = (
        max(
            (
                point.drawdown / (point.equity + point.drawdown)
                if point.equity + point.drawdown > 0
                else 0.0
            )
            for point in equity
        )
        if equity
        else 0.0
    )
    recovery = net_profit / max_drawdown if max_drawdown > 0 else None
    if recovery is None:
        reasons["recovery_factor"] = "maximum drawdown is zero"
    best_wins, best_losses = _streaks([value > 0 for value in pnls])
    ambiguity_count = sum(trade.intrabar_ambiguous for trade in trades)
    exposure = sum(point.exposure > 0 for point in equity) / len(equity) * 100 if equity else 0.0
    average_holding_seconds = (
        statistics.fmean((trade.exit_time - trade.entry_time).total_seconds() for trade in trades)
        if trades
        else 0.0
    )
    return {
        "total_return": net_profit / initial_capital,
        "net_profit": net_profit,
        "gross_profit": gross_profit,
        "gross_loss": gross_loss,
        "win_rate": len(wins) / trade_count if trade_count else 0.0,
        "loss_rate": len(losses) / trade_count if trade_count else 0.0,
        "profit_factor": profit_factor,
        "expectancy": statistics.fmean(pnls) if pnls else 0.0,
        "trade_count": trade_count,
        "long_trade_count": sum(trade.side == Side.LONG for trade in trades),
        "short_trade_count": sum(trade.side == Side.SHORT for trade in trades),
        "average_win": statistics.fmean(wins) if wins else 0.0,
        "average_loss": statistics.fmean(losses) if losses else 0.0,
        "average_r": average_r,
        "median_r": median_r,
        "best_trade": max(pnls) if pnls else None,
        "worst_trade": min(pnls) if pnls else None,
        "maximum_drawdown": max_drawdown,
        "maximum_drawdown_percent": max_drawdown_percent,
        "sharpe_ratio": sharpe,
        "sortino_ratio": sortino,
        "recovery_factor": recovery,
        "average_holding_bars": statistics.fmean([trade.holding_bars for trade in trades])
        if trades
        else 0.0,
        "average_holding_time_seconds": average_holding_seconds,
        "maximum_consecutive_wins": best_wins,
        "maximum_consecutive_losses": best_losses,
        "exposure_percent": exposure,
        "commission_total": sum(trade.commission_cost for trade in trades),
        "spread_cost_total": sum(trade.spread_cost for trade in trades),
        "slippage_cost_total": sum(trade.slippage_cost for trade in trades),
        "carry_cost_total": sum(trade.carry_cost for trade in trades),
        "intrabar_ambiguity_count": ambiguity_count,
        "intrabar_ambiguity_rate": ambiguity_count / trade_count if trade_count else 0.0,
        "by_symbol": _breakdown(trades, "symbol"),
        "by_direction": _breakdown(trades, "side"),
        "by_session": _breakdown(trades, "session"),
        "by_day_of_week": {
            str(day): {
                "trade_count": len(items),
                "net_profit": sum(item.net_pnl for item in items),
            }
            for day, items in sorted(
                {
                    day: [trade for trade in trades if trade.entry_time.weekday() == day]
                    for day in {trade.entry_time.weekday() for trade in trades}
                }.items()
            )
        },
        "by_exit_reason": _breakdown(trades, "exit_reason"),
        "by_market_regime": _breakdown(trades, "market_regime"),
        "by_condition_set": _breakdown(trades, "condition_set"),
        "metric_reasons": reasons,
        "annualization_periods": annual_periods(timeframe),
    }
