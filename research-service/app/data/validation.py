from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.data.errors import DatasetInputError, DatasetLimitError
from app.data.gaps import detect_gaps
from app.data.hashing import dataset_hash
from app.data.models import (
    CanonicalBar,
    CanonicalDataset,
    DatasetLimits,
    DatasetQualityReport,
    DatasetValidationResult,
)


def validate_dataset(
    bars: tuple[CanonicalBar, ...] | list[CanonicalBar],
    *,
    limits: DatasetLimits | None = None,
    run_end: datetime | None = None,
) -> DatasetValidationResult:
    resolved_limits = limits or DatasetLimits()
    if not bars:
        raise DatasetInputError("dataset cannot be empty")
    if len(bars) > resolved_limits.max_rows:
        raise DatasetLimitError("dataset row limit exceeded")
    if run_end is not None:
        if run_end.tzinfo is None or run_end.utcoffset() is None:
            raise DatasetInputError("run end must be timezone-aware")
        run_end = run_end.astimezone(UTC)

    sources = {bar.source for bar in bars}
    if len(sources) != 1:
        raise DatasetInputError("mixed dataset sources are not allowed")
    symbols = {bar.symbol for bar in bars}
    if len(symbols) > resolved_limits.max_symbols:
        raise DatasetLimitError("dataset symbol limit exceeded")

    seen: set[tuple[str, str, datetime]] = set()
    latest: dict[tuple[str, str], datetime] = {}
    for bar in bars:
        series_key = (bar.symbol, bar.timeframe.value)
        row_key = (*series_key, bar.timestamp)
        if row_key in seen:
            raise DatasetInputError("duplicate bar timestamp")
        seen.add(row_key)
        previous = latest.get(series_key)
        if previous is not None and bar.timestamp <= previous:
            raise DatasetInputError("bars must be strictly increasing per symbol and timeframe")
        latest[series_key] = bar.timestamp
        if run_end is not None and bar.timestamp > run_end:
            raise DatasetInputError("dataset contains a bar beyond the configured run end")

    start = min(bar.timestamp for bar in bars)
    end = max(bar.timestamp for bar in bars)
    if end - start > timedelta(days=resolved_limits.max_date_range_days):
        raise DatasetLimitError("dataset date range limit exceeded")

    gaps = detect_gaps(tuple(bars))
    digest = dataset_hash(tuple(bars))
    row_count = len(bars)
    quality = DatasetQualityReport(
        row_count=row_count,
        start_time=start,
        end_time=end,
        duplicates=0,
        invalid_rows=0,
        missing_intervals=sum(gap.missing_intervals for gap in gaps),
        largest_gap=max((gap.gap_seconds for gap in gaps), default=None),
        spread_coverage=sum(bar.spread is not None for bar in bars) / row_count,
        volume_coverage=sum(bar.volume is not None for bar in bars) / row_count,
        source=next(iter(sources)),
        dataset_hash=digest,
    )
    dataset = CanonicalDataset(source=quality.source, bars=tuple(bars), dataset_hash=digest)
    return DatasetValidationResult(dataset=dataset, quality=quality, gaps=gaps)
