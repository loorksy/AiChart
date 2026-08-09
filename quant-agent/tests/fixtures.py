"""Synthetic OHLCV bar builders used across the test suite. Each builder is
hand-tuned (and verified against the real engine, not just eyeballed) to put
one specific strategy's gate conditions on the final bar."""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from typing import Any


def make_bars(prices: list[float], *, interval_minutes: int = 15) -> list[dict[str, Any]]:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    bars: list[dict[str, Any]] = []
    for index, price in enumerate(prices):
        moment = start + timedelta(minutes=interval_minutes * index)
        bars.append(
            {
                "time": moment.isoformat(),
                "open": price,
                "high": price + 0.0003,
                "low": price - 0.0003,
                "close": price,
                "volume": 1000.0,
            }
        )
    return bars


def bars_triggering_ema_trend_buy() -> list[dict[str, Any]]:
    """180 bars steady uptrend, 35 bars pullback (flips EMA20 below EMA50
    without dropping price below EMA200), then an up-move truncated exactly
    at the bar where EMA20 crosses back above EMA50 with ADX14>20 and price
    above EMA200 — the ema_trend_v1 buy trigger."""
    prices: list[float] = []
    price = 1.1000
    for _ in range(180):
        price += 0.00030
        prices.append(price)
    for _ in range(35):
        price -= 0.00060
        prices.append(price)
    for _ in range(17):
        price += 0.00090
        prices.append(price)
    return make_bars(prices)


def bars_triggering_rsi_reversion_buy() -> list[dict[str, Any]]:
    """A gentle 15-bar-period sine oscillation (keeps ADX14<20, i.e.
    regime=='range') followed by a short sharp drop that pushes RSI14<=30
    and price through the lower Bollinger band on the final bar — the
    rsi_reversion_v1 buy trigger."""
    prices: list[float] = []
    base = 1.1000
    amplitude = 0.0010
    period = 15
    for i in range(230 - 4):
        prices.append(base + amplitude * math.sin(2 * math.pi * i / period))
    last = prices[-1]
    for _ in range(4):
        last -= 0.0006
        prices.append(last)
    return make_bars(prices)


def bars_no_signal() -> list[dict[str, Any]]:
    """A gentle, low-amplitude sideways oscillation with no crossover and no
    RSI extreme anywhere near the final bar — neither strategy should fire."""
    prices: list[float] = []
    base = 1.1000
    for i in range(230):
        prices.append(base + 0.0008 * math.sin(2 * math.pi * i / 22))
    return make_bars(prices)
