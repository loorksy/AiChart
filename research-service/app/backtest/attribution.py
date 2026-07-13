from __future__ import annotations

from collections import defaultdict
from typing import Any

from .models import Order, OrderStatus, Trade


def _trade_view(trade: Trade) -> dict[str, Any]:
    return {
        "trade_id": trade.trade_id,
        "symbol": trade.symbol,
        "side": trade.side.value,
        "net_pnl": trade.net_pnl,
        "exit_reason": trade.exit_reason,
        "holding_bars": trade.holding_bars,
    }


def build_attribution(trades: list[Trade], orders: list[Order]) -> dict[str, Any]:
    ranked = sorted(trades, key=lambda trade: trade.net_pnl, reverse=True)
    total = sum(trade.net_pnl for trade in trades)

    def without_top(count: int) -> float:
        return total - sum(trade.net_pnl for trade in ranked[:count])

    holding: dict[str, list[Trade]] = defaultdict(list)
    for trade in trades:
        bucket = (
            "0-4"
            if trade.holding_bars < 5
            else "5-19"
            if trade.holding_bars < 20
            else "20-99"
            if trade.holding_bars < 100
            else "100+"
        )
        holding[bucket].append(trade)
    return {
        "descriptive_only": True,
        "top_winners": [_trade_view(trade) for trade in ranked[:5]],
        "top_losers": [_trade_view(trade) for trade in sorted(trades, key=lambda t: t.net_pnl)[:5]],
        "remove_top_1_winner": without_top(1),
        "remove_top_3_winners": without_top(3),
        "remove_top_5_winners": without_top(5),
        "exit_reason_breakdown": _group(trades, lambda trade: trade.exit_reason),
        "holding_time_buckets": {
            name: {"count": len(items), "net_profit": sum(item.net_pnl for item in items)}
            for name, items in sorted(holding.items())
        },
        "session_breakdown": _group(trades, lambda trade: trade.session),
        "regime_breakdown": _group(trades, lambda trade: trade.market_regime or "unknown"),
        "long_short_breakdown": _group(trades, lambda trade: trade.side.value),
        "cost_attribution": {
            "spread": sum(trade.spread_cost for trade in trades),
            "slippage": sum(trade.slippage_cost for trade in trades),
            "commission": sum(trade.commission_cost for trade in trades),
            "carry": sum(trade.carry_cost for trade in trades),
        },
        "ambiguous_events": [_trade_view(trade) for trade in trades if trade.intrabar_ambiguous],
        "cancelled_pending_orders": [
            order.order_id for order in orders if order.status == OrderStatus.CANCELLED
        ],
        "missed_orders": [
            order.order_id for order in orders if order.status == OrderStatus.EXPIRED
        ],
    }


def _group(trades: list[Trade], key: Any) -> dict[str, dict[str, float | int]]:
    groups: dict[str, list[Trade]] = defaultdict(list)
    for trade in trades:
        groups[str(key(trade))].append(trade)
    return {
        name: {"count": len(items), "net_profit": sum(item.net_pnl for item in items)}
        for name, items in sorted(groups.items())
    }
