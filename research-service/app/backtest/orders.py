from __future__ import annotations

from typing import Any

from .models import Order, OrderStatus, OrderType, Side


def order_trigger_reference(order: Order, bar: Any) -> float | None:
    if order.status != OrderStatus.PENDING:
        return None
    if order.order_type == OrderType.MARKET:
        return float(bar.open)
    assert order.requested_price is not None
    price = order.requested_price
    if order.order_type == OrderType.LIMIT:
        touched = bar.low <= price if order.side == Side.LONG else bar.high >= price
        # Conservative favorable-gap policy: fill at the requested limit, never improve to open.
        return price if touched else None
    if order.order_type == OrderType.STOP:
        touched = bar.high >= price if order.side == Side.LONG else bar.low <= price
        if not touched:
            return None
        # Unfavorable gap-through fills at the next available open.
        if order.side == Side.LONG and bar.open > price:
            return float(bar.open)
        if order.side == Side.SHORT and bar.open < price:
            return float(bar.open)
        return price
    return None


def expire_order(order: Order, index: int) -> bool:
    if order.status == OrderStatus.PENDING and index > order.expiry_index:
        order.status = OrderStatus.EXPIRED
        order.cancellation_reason = "validity_expired"
        return True
    return False
