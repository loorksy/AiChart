"""Pure, dependency-light feature extraction from a list of OHLC(V) bars.

No heavy numeric library is used — research-service's own indicator module
(`research-service/app/backtest/indicators.py`) only depends on the stdlib
(`math`), and this service follows the same convention rather than adding a
numpy dependency for a handful of rolling averages.

Every function here is pure: given the same bars it always returns the same
series. Indices line up 1:1 with the input bar list; a value is `None`
wherever there is not yet enough history to compute it.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from app.storage.models import Bar

Regime = Literal["trend", "range", "high_volatility", "low_liquidity"]

# ADX14 threshold used both by the trend gate (ema_trend_v1) and by the
# regime classifier below, so the two stay in lockstep (see engine/combine.py
# module docstring for why that matters).
ADX_TREND_THRESHOLD = 20.0
# A bar is "high volatility" once its ATR14 exceeds this multiple of the
# trailing 50-bar average ATR14.
ATR_VOLATILITY_MULTIPLIER = 1.8
ATR_VOLATILITY_LOOKBACK = 50
# A bar is "low liquidity" once its volume drops below this fraction of the
# trailing 20-bar average volume (only evaluated when volume is reported).
LOW_LIQUIDITY_VOLUME_RATIO = 0.25
LOW_LIQUIDITY_LOOKBACK = 20


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


def adx(
    highs: Sequence[float], lows: Sequence[float], closes: Sequence[float], period: int = 14
) -> list[float | None]:
    """Wilder's Average Directional Index."""
    n = len(closes)
    out: list[float | None] = [None] * n
    if n < period * 2:
        return out
    ranges = true_range(highs, lows, closes)
    plus_dm = [0.0] * n
    minus_dm = [0.0] * n
    for i in range(1, n):
        up_move = highs[i] - highs[i - 1]
        down_move = lows[i - 1] - lows[i]
        plus_dm[i] = up_move if (up_move > down_move and up_move > 0) else 0.0
        minus_dm[i] = down_move if (down_move > up_move and down_move > 0) else 0.0

    def wilder_smooth(series: Sequence[float]) -> list[float | None]:
        smoothed: list[float | None] = [None] * n
        seed = sum(series[1 : period + 1])
        smoothed[period] = seed
        current = seed
        for i in range(period + 1, n):
            current = current - (current / period) + series[i]
            smoothed[i] = current
        return smoothed

    tr_smoothed = wilder_smooth(ranges)
    plus_smoothed = wilder_smooth(plus_dm)
    minus_smoothed = wilder_smooth(minus_dm)

    dx: list[float | None] = [None] * n
    for i in range(period, n):
        tr_i = tr_smoothed[i]
        plus_i = plus_smoothed[i]
        minus_i = minus_smoothed[i]
        if not tr_i:
            continue
        plus_di = 100 * (plus_i or 0.0) / tr_i
        minus_di = 100 * (minus_i or 0.0) / tr_i
        denom = plus_di + minus_di
        dx[i] = 0.0 if denom == 0 else 100 * abs(plus_di - minus_di) / denom

    first_dx = next((i for i, value in enumerate(dx) if value is not None), None)
    if first_dx is None:
        return out
    window_end = first_dx + period
    if window_end > n:
        return out
    seed_values = [value for value in dx[first_dx:window_end] if value is not None]
    if len(seed_values) < period:
        return out
    current_adx = sum(seed_values) / period
    out[window_end - 1] = current_adx
    for i in range(window_end, n):
        value = dx[i]
        if value is None:
            continue
        current_adx = (current_adx * (period - 1) + value) / period
        out[i] = current_adx
    return out


@dataclass
class Features:
    """Latest-bar-anchored indicator snapshot plus the full series used to
    detect events (e.g. an EMA cross) that need the previous bar too."""

    symbol: str
    market: str
    interval: str
    times: list[str]
    opens: list[float]
    highs: list[float]
    lows: list[float]
    closes: list[float]
    volumes: list[float | None]
    ema20: list[float | None]
    ema50: list[float | None]
    ema200: list[float | None]
    rsi14: list[float | None]
    macd_line: list[float | None]
    macd_signal: list[float | None]
    macd_hist: list[float | None]
    atr14: list[float | None]
    bb_lower: list[float | None]
    bb_middle: list[float | None]
    bb_upper: list[float | None]
    adx14: list[float | None]
    regime: Regime = field(init=False, default="range")

    def __post_init__(self) -> None:
        self.regime = classify_regime(
            adx_value=self.adx14[-1],
            atr_value=self.atr14[-1],
            atr_history=[v for v in self.atr14[-1 - ATR_VOLATILITY_LOOKBACK : -1] if v is not None],
            volume_value=self.volumes[-1],
            volume_history=[
                v for v in self.volumes[-1 - LOW_LIQUIDITY_LOOKBACK : -1] if v is not None
            ],
        )

    @property
    def last(self) -> int:
        return len(self.closes) - 1


def classify_regime(
    *,
    adx_value: float | None,
    atr_value: float | None,
    atr_history: Sequence[float],
    volume_value: float | None,
    volume_history: Sequence[float],
) -> Regime:
    """"trend"|"range"|"high_volatility"|"low_liquidity" from ADX14/ATR14
    (plan section 3), with volume used only as a low-liquidity override when
    the caller actually reports it — many forex feeds do not."""
    if volume_value is not None and volume_history:
        avg_volume = sum(volume_history) / len(volume_history)
        if avg_volume > 0 and volume_value < LOW_LIQUIDITY_VOLUME_RATIO * avg_volume:
            return "low_liquidity"
    if adx_value is None or atr_value is None:
        # Not enough history for a confident read: default to the more
        # conservative "range" label rather than assuming a trend exists.
        return "range"
    if atr_history:
        avg_atr = sum(atr_history) / len(atr_history)
        if avg_atr > 0 and atr_value > ATR_VOLATILITY_MULTIPLIER * avg_atr:
            return "high_volatility"
    return "trend" if adx_value > ADX_TREND_THRESHOLD else "range"


def compute_features(symbol: str, market: str, interval: str, bars: Sequence[Bar]) -> Features:
    opens = [bar.open for bar in bars]
    highs = [bar.high for bar in bars]
    lows = [bar.low for bar in bars]
    closes = [bar.close for bar in bars]
    volumes: list[float | None] = [bar.volume for bar in bars]
    macd_line, macd_signal, macd_hist = macd(closes)
    bb_lower, bb_middle, bb_upper = bollinger(closes)
    return Features(
        symbol=symbol,
        market=market,
        interval=interval,
        times=[bar.time for bar in bars],
        opens=opens,
        highs=highs,
        lows=lows,
        closes=closes,
        volumes=volumes,
        ema20=ema(closes, 20),
        ema50=ema(closes, 50),
        ema200=ema(closes, 200),
        rsi14=rsi(closes, 14),
        macd_line=macd_line,
        macd_signal=macd_signal,
        macd_hist=macd_hist,
        atr14=atr(highs, lows, closes, 14),
        bb_lower=bb_lower,
        bb_middle=bb_middle,
        bb_upper=bb_upper,
        adx14=adx(highs, lows, closes, 14),
    )
