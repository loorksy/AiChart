from __future__ import annotations

from bisect import bisect_right
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta

from app.data.errors import DatasetInputError
from app.data.models import TIMEFRAME_SECONDS, CanonicalBar, Timeframe


class ClosedBarAligner:
    """Point-in-time lookup that exposes only fully closed higher-timeframe bars."""

    def __init__(self, bars: Sequence[CanonicalBar]) -> None:
        if not bars:
            raise DatasetInputError("alignment series cannot be empty")
        identity = {(bar.symbol, bar.timeframe) for bar in bars}
        if len(identity) != 1:
            raise DatasetInputError("alignment series must contain one symbol and timeframe")
        previous: datetime | None = None
        for bar in bars:
            if previous is not None and bar.timestamp <= previous:
                raise DatasetInputError("alignment bars must be strictly increasing")
            previous = bar.timestamp
        self._bars = tuple(bars)
        interval = timedelta(seconds=TIMEFRAME_SECONDS[self._bars[0].timeframe])
        self._closed_at = tuple(bar.timestamp + interval for bar in self._bars)

    @property
    def timeframe(self) -> Timeframe:
        return self._bars[0].timeframe

    @property
    def symbol(self) -> str:
        return self._bars[0].symbol

    def last_closed_at(self, available_at: datetime) -> CanonicalBar | None:
        if available_at.tzinfo is None or available_at.utcoffset() is None:
            raise DatasetInputError("alignment time must be timezone-aware")
        point = available_at.astimezone(UTC)
        index = bisect_right(self._closed_at, point) - 1
        return self._bars[index] if index >= 0 else None


def align_closed_bars(
    available_at: datetime,
    *,
    symbol: str,
    higher_timeframes: Mapping[Timeframe, Sequence[CanonicalBar]],
) -> dict[Timeframe, CanonicalBar | None]:
    aligned: dict[Timeframe, CanonicalBar | None] = {}
    for timeframe, bars in higher_timeframes.items():
        aligner = ClosedBarAligner(bars)
        if aligner.symbol != symbol or aligner.timeframe != timeframe:
            raise DatasetInputError("alignment registry key does not match its bar series")
        aligned[timeframe] = aligner.last_closed_at(available_at)
    return aligned
