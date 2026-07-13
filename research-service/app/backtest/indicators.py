from __future__ import annotations

import math
from collections.abc import Sequence

INDICATOR_VERSION = "aichart-indicators-v1"


def sma(values: Sequence[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if period <= 0:
        raise ValueError("period must be positive")
    running = 0.0
    for index, value in enumerate(values):
        running += value
        if index >= period:
            running -= values[index - period]
        if index >= period - 1:
            out[index] = running / period
    return out


def ema(values: Sequence[float], period: int) -> list[float | None]:
    if period <= 0:
        raise ValueError("period must be positive")
    out: list[float | None] = [None] * len(values)
    if len(values) < period:
        return out
    seed = sum(values[:period]) / period
    out[period - 1] = seed
    alpha = 2 / (period + 1)
    previous = seed
    for index in range(period, len(values)):
        previous = alpha * values[index] + (1 - alpha) * previous
        out[index] = previous
    return out


def rsi(values: Sequence[float], period: int = 14) -> list[float | None]:
    if period <= 0:
        raise ValueError("period must be positive")
    out: list[float | None] = [None] * len(values)
    if len(values) <= period:
        return out
    gains = [max(0.0, values[i] - values[i - 1]) for i in range(1, len(values))]
    losses = [max(0.0, values[i - 1] - values[i]) for i in range(1, len(values))]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    out[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for index in range(period + 1, len(values)):
        avg_gain = (avg_gain * (period - 1) + gains[index - 1]) / period
        avg_loss = (avg_loss * (period - 1) + losses[index - 1]) / period
        out[index] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def true_range(
    highs: Sequence[float], lows: Sequence[float], closes: Sequence[float]
) -> list[float]:
    if not (len(highs) == len(lows) == len(closes)):
        raise ValueError("OHLC lengths differ")
    out: list[float] = []
    for index in range(len(closes)):
        if index == 0:
            out.append(highs[index] - lows[index])
        else:
            out.append(
                max(
                    highs[index] - lows[index],
                    abs(highs[index] - closes[index - 1]),
                    abs(lows[index] - closes[index - 1]),
                )
            )
    return out


def atr(
    highs: Sequence[float], lows: Sequence[float], closes: Sequence[float], period: int = 14
) -> list[float | None]:
    ranges = true_range(highs, lows, closes)
    out: list[float | None] = [None] * len(ranges)
    if len(ranges) < period:
        return out
    current = sum(ranges[:period]) / period
    out[period - 1] = current
    for index in range(period, len(ranges)):
        current = (current * (period - 1) + ranges[index]) / period
        out[index] = current
    return out


def macd(
    values: Sequence[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[list[float | None], list[float | None], list[float | None]]:
    fast_values = ema(values, fast)
    slow_values = ema(values, slow)
    line: list[float | None] = [
        None if a is None or b is None else a - b
        for a, b in zip(fast_values, slow_values, strict=False)
    ]
    compact = [value for value in line if value is not None]
    compact_signal = ema(compact, signal)
    signal_line: list[float | None] = [None] * len(values)
    offset = next((i for i, value in enumerate(line) if value is not None), len(values))
    for index, value in enumerate(compact_signal):
        signal_line[offset + index] = value
    histogram = [
        None if a is None or b is None else a - b for a, b in zip(line, signal_line, strict=False)
    ]
    return line, signal_line, histogram


def bollinger(
    values: Sequence[float], period: int = 20, deviations: float = 2.0
) -> tuple[list[float | None], list[float | None], list[float | None]]:
    middle = sma(values, period)
    upper: list[float | None] = [None] * len(values)
    lower: list[float | None] = [None] * len(values)
    for index in range(period - 1, len(values)):
        window = values[index - period + 1 : index + 1]
        mean = middle[index]
        assert mean is not None
        variance = sum((value - mean) ** 2 for value in window) / period
        std = math.sqrt(variance)
        upper[index] = mean + deviations * std
        lower[index] = mean - deviations * std
    return lower, middle, upper


def rolling_high(values: Sequence[float], period: int) -> list[float | None]:
    return [
        None if i < period - 1 else max(values[i - period + 1 : i + 1]) for i in range(len(values))
    ]


def rolling_low(values: Sequence[float], period: int) -> list[float | None]:
    return [
        None if i < period - 1 else min(values[i - period + 1 : i + 1]) for i in range(len(values))
    ]


def candle_pattern(open_: float, high: float, low: float, close: float) -> str | None:
    body = abs(close - open_)
    span = high - low
    if span <= 0:
        return None
    upper = high - max(open_, close)
    lower = min(open_, close) - low
    if lower >= body * 2 and upper <= max(body, span * 0.15):
        return "hammer"
    if upper >= body * 2 and lower <= max(body, span * 0.15):
        return "shooting_star"
    if body <= span * 0.1:
        return "doji"
    return "bullish" if close > open_ else "bearish" if close < open_ else None
