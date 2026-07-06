"""Lightweight technical indicators computed in code (the cheap monitoring
layer). Faithful Python port of the former AiChart ``lib/indicators.ts``.

These run on every request without calling the LLM, so the expensive
decision layer is only invoked with structured signals. Pure functions —
no I/O, safe to unit-test.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


@dataclass
class Candle:
    high: float
    low: float
    close: float
    open: float = 0.0


def sma(values: Sequence[float], period: int) -> float | None:
    if len(values) < period:
        return None
    window = values[-period:]
    return sum(window) / period


def atr(candles: Sequence[Candle], period: int = 14) -> float | None:
    """Average True Range — volatility measure for adaptive stops/sizing.

    TR = max(high-low, |high-prevClose|, |low-prevClose|); ATR = mean(TR, period).
    """
    if len(candles) < period + 1:
        return None
    trs: list[float] = []
    for i in range(1, len(candles)):
        c = candles[i]
        prev_close = candles[i - 1].close
        trs.append(
            max(
                c.high - c.low,
                abs(c.high - prev_close),
                abs(c.low - prev_close),
            )
        )
    window = trs[-period:]
    if not window:
        return None
    return sum(window) / len(window)


def ema(values: Sequence[float], period: int) -> float | None:
    if len(values) < period:
        return None
    k = 2 / (period + 1)
    # Seed with SMA of the first `period` values.
    prev = sum(values[:period]) / period
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1 - k)
    return prev


def rsi(values: Sequence[float], period: int = 14) -> float | None:
    """Wilder's RSI. Returns a value in [0, 100] or None if not enough data."""
    if len(values) < period + 1:
        return None
    gain = 0.0
    loss = 0.0
    for i in range(1, period + 1):
        diff = values[i] - values[i - 1]
        if diff >= 0:
            gain += diff
        else:
            loss -= diff
    avg_gain = gain / period
    avg_loss = loss / period
    for i in range(period + 1, len(values)):
        diff = values[i] - values[i - 1]
        g = diff if diff > 0 else 0.0
        l = -diff if diff < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


@dataclass
class MacdResult:
    macd: float
    signal: float
    histogram: float


def macd(
    values: Sequence[float],
    fast: int = 12,
    slow: int = 26,
    signal_period: int = 9,
) -> MacdResult | None:
    if len(values) < slow + signal_period:
        return None
    # Build a MACD-line series so we can EMA it for the signal line.
    macd_series: list[float] = []
    for i in range(slow, len(values) + 1):
        window = values[:i]
        f = ema(window, fast)
        s = ema(window, slow)
        if f is None or s is None:
            continue
        macd_series.append(f - s)
    if not macd_series:
        return None
    macd_line = macd_series[-1]
    signal = ema(macd_series, signal_period)
    if signal is None:
        return None
    return MacdResult(macd=macd_line, signal=signal, histogram=macd_line - signal)
