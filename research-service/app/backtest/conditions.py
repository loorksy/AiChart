from __future__ import annotations

import bisect
import math
from dataclasses import dataclass, field
from datetime import datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from .indicators import (
    atr,
    bollinger,
    candle_pattern,
    ema,
    macd,
    rolling_high,
    rolling_low,
    rsi,
    sma,
)
from .policies import TIMEFRAME_MINUTES, forex_session, symbol_metadata


def _value(value: Any) -> float:
    return float(value)


@dataclass(slots=True)
class ConditionContext:
    bars_by_timeframe: dict[str, list[Any]]
    decision_time: datetime
    default_timeframe: str
    cache: dict[tuple[Any, ...], list[Any]] = field(default_factory=dict)

    def index(self, timeframe: str) -> int:
        bars = self.bars_by_timeframe.get(timeframe, [])
        duration = TIMEFRAME_MINUTES[timeframe] * 60
        close_times = [bar.timestamp.timestamp() + duration for bar in bars]
        return bisect.bisect_right(close_times, self.decision_time.timestamp()) - 1

    def bars(self, timeframe: str) -> tuple[list[Any], int]:
        bars = self.bars_by_timeframe.get(timeframe, [])
        return bars, self.index(timeframe)

    def series(self, timeframe: str, name: str, args: tuple[Any, ...]) -> list[Any]:
        symbol = self.bars_by_timeframe[timeframe][0].symbol
        key = (symbol, timeframe, name, args)
        if key in self.cache:
            return self.cache[key]
        bars = self.bars_by_timeframe[timeframe]
        closes = [_value(bar.close) for bar in bars]
        highs = [_value(bar.high) for bar in bars]
        lows = [_value(bar.low) for bar in bars]
        if name == "ema":
            result = ema(closes, int(args[0]))
        elif name == "sma":
            result = sma(closes, int(args[0]))
        elif name == "rsi":
            result = rsi(closes, int(args[0]))
        elif name == "atr":
            result = atr(highs, lows, closes, int(args[0]))
        elif name == "macd":
            result = list(macd(closes, *map(int, args))[0])
        elif name == "macd_signal":
            result = list(macd(closes, *map(int, args))[1])
        elif name == "bollinger_lower":
            result = list(bollinger(closes, int(args[0]), float(args[1]))[0])
        elif name == "bollinger_upper":
            result = list(bollinger(closes, int(args[0]), float(args[1]))[2])
        elif name == "rolling_high":
            result = rolling_high(highs, int(args[0]))
        elif name == "rolling_low":
            result = rolling_low(lows, int(args[0]))
        else:
            raise ValueError(f"unsupported indicator {name}")
        self.cache[key] = result
        return result


def _relation(current: float, previous: float | None, threshold: float, operator: str) -> bool:
    if operator == "above":
        return current > threshold
    if operator == "below":
        return current < threshold
    if operator == "equal":
        return math.isclose(current, threshold, rel_tol=1e-12, abs_tol=1e-12)
    if previous is None:
        return False
    if operator == "crosses_above":
        return previous <= threshold < current
    if operator == "crosses_below":
        return previous >= threshold > current
    raise ValueError(f"unsupported operator {operator}")


def evaluate_condition(node: dict[str, Any], context: ConditionContext) -> bool:
    if "all" in node and node["all"] is not None:
        return all(evaluate_condition(item, context) for item in node["all"])
    if "any" in node and node["any"] is not None:
        return any(evaluate_condition(item, context) for item in node["any"])
    negated = node.get("not") or node.get("not_")
    if negated is not None:
        return not evaluate_condition(negated, context)
    kind = node["type"]
    timeframe = str(node.get("timeframe", context.default_timeframe))
    bars, index = context.bars(timeframe)
    if index < 0:
        return False
    bar = bars[index]
    if kind == "price_comparison":
        field = node.get("price", node.get("left", "close"))
        current = _value(getattr(bar, field))
        if node.get("right_reference"):
            reference = str(node["right_reference"])
            source_index = index - 1 if reference.startswith("previous_") else index
            if source_index < 0:
                return False
            threshold = _value(getattr(bars[source_index], reference.removeprefix("previous_")))
        else:
            threshold = float(node.get("value", node.get("right_value", 0)))
        previous = _value(getattr(bars[index - 1], field)) if index > 0 else None
        return _relation(current, previous, threshold, node["operator"])
    if kind in {"ema_relation", "sma_relation"}:
        name = "ema" if kind.startswith("ema") else "sma"
        fast = context.series(timeframe, name, (node["fast_period"],))
        slow = context.series(timeframe, name, (node["slow_period"],))
        if fast[index] is None or slow[index] is None:
            return False
        previous_diff = None
        if index > 0 and fast[index - 1] is not None and slow[index - 1] is not None:
            previous_diff = float(fast[index - 1]) - float(slow[index - 1])
        return _relation(
            float(fast[index]) - float(slow[index]), previous_diff, 0.0, node["operator"]
        )
    if kind in {"rsi_threshold", "atr_threshold"}:
        name = "rsi" if kind.startswith("rsi") else "atr"
        values = context.series(timeframe, name, (node["period"],))
        if values[index] is None:
            return False
        previous = values[index - 1] if index > 0 else None
        current_value = float(values[index])
        previous_value = float(previous) if previous is not None else None
        threshold = float(node["value"])
        if kind == "atr_threshold":
            unit = node["unit"]
            metadata = symbol_metadata(str(bar.symbol))
            if unit == "pips":
                current_value /= metadata.pip_size
                previous_value = (
                    previous_value / metadata.pip_size if previous_value is not None else None
                )
            elif unit == "percentage":
                close = _value(bar.close)
                if close <= 0:
                    return False
                current_value = current_value / close * 100
                if previous_value is not None and index > 0:
                    previous_close = _value(bars[index - 1].close)
                    previous_value = previous_value / previous_close * 100
        return _relation(current_value, previous_value, threshold, node["operator"])
    if kind == "macd_relation":
        macd_args = (
            node.get("fast_period", 12),
            node.get("slow_period", 26),
            node.get("signal_period", 9),
        )
        line = context.series(timeframe, "macd", macd_args)
        signal_line = context.series(timeframe, "macd_signal", macd_args)
        if line[index] is None or signal_line[index] is None:
            return False
        previous = None
        if index > 0 and line[index - 1] is not None and signal_line[index - 1] is not None:
            previous = float(line[index - 1]) - float(signal_line[index - 1])
        return _relation(
            float(line[index]) - float(signal_line[index]), previous, 0, node["operator"]
        )
    if kind == "bollinger_position":
        bollinger_args = (node.get("period", 20), node.get("deviations", 2.0))
        lower = context.series(timeframe, "bollinger_lower", bollinger_args)[index]
        upper = context.series(timeframe, "bollinger_upper", bollinger_args)[index]
        if lower is None or upper is None:
            return False
        position = node["position"]
        return bool(
            _value(bar.close) < lower if position == "below_lower" else _value(bar.close) > upper
        )
    if kind == "range_breakout":
        period = int(node["lookback_bars"])
        if index < period:
            return False
        prior = bars[index - period : index]
        metadata = symbol_metadata(str(bar.symbol))
        offset = float(node.get("offset_pips", 0)) * metadata.pip_size
        use_close = node.get("confirmation", "close") == "close"
        upper_value = _value(bar.close if use_close else bar.high)
        lower_value = _value(bar.close if use_close else bar.low)
        return (
            upper_value > max(_value(item.high) for item in prior) + offset
            if node["direction"] in {"above", "above_high"}
            else lower_value < min(_value(item.low) for item in prior) - offset
        )
    if kind == "candle_pattern":
        return (
            candle_pattern(_value(bar.open), _value(bar.high), _value(bar.low), _value(bar.close))
            in node["patterns"]
        )
    if kind == "market_session":
        active = set(forex_session(context.decision_time).split("+"))
        if {"london", "new_york"}.issubset(active):
            active.add("london_new_york_overlap")
        return any(name in active for name in node["sessions"])
    if kind == "day_of_week":
        names = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
        return names[context.decision_time.weekday()] in node["days"]
    if kind == "time_window":
        localized = context.decision_time.astimezone(ZoneInfo(node["timezone"]))
        current_time = localized.time().replace(tzinfo=None)
        start_time = time.fromisoformat(node.get("start") or node["start_time"])
        end_time = time.fromisoformat(node.get("end") or node["end_time"])
        return bool(
            start_time <= current_time < end_time
            if start_time < end_time
            else current_time >= start_time or current_time < end_time
        )
    raise ValueError(f"unsupported condition type {kind}")
