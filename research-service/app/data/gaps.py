from __future__ import annotations

import math
from collections import defaultdict

from app.data.models import TIMEFRAME_SECONDS, CanonicalBar, GapRecord


def detect_gaps(bars: tuple[CanonicalBar, ...] | list[CanonicalBar]) -> tuple[GapRecord, ...]:
    grouped: dict[tuple[str, str], list[CanonicalBar]] = defaultdict(list)
    for bar in bars:
        grouped[(bar.symbol, bar.timeframe.value)].append(bar)
    gaps: list[GapRecord] = []
    for series in grouped.values():
        interval = TIMEFRAME_SECONDS[series[0].timeframe]
        for previous, current in zip(series, series[1:], strict=False):
            delta = int((current.timestamp - previous.timestamp).total_seconds())
            if delta <= interval:
                continue
            missing = max(1, math.ceil(delta / interval) - 1)
            gaps.append(
                GapRecord(
                    symbol=current.symbol,
                    timeframe=current.timeframe,
                    previous_timestamp=previous.timestamp,
                    next_timestamp=current.timestamp,
                    missing_intervals=missing,
                    gap_seconds=delta,
                )
            )
    return tuple(gaps)
