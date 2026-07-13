from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.data.errors import DatasetInputError, DatasetLimitError
from app.data.loaders.aichart_candle_warehouse import load_aichart_candle_warehouse
from app.data.models import DatasetLimits


def envelope(*bars, exported_at: str = "2025-01-06T10:00:00Z"):
    return {
        "schema_version": "aichart-candle-warehouse-v1",
        "source": "aichart_candle_warehouse",
        "exported_at": exported_at,
        "closed_bars_only": True,
        "bars": list(bars),
    }


def row(timestamp: str = "2025-01-06T09:00:00Z", **overrides):
    value = {
        "timestamp": timestamp,
        "open": "1.1",
        "high": "1.2",
        "low": "1.0",
        "close": "1.15",
        "volume": "100",
        "spread": "0.0002",
        "symbol": "EURUSD",
        "timeframe": "1h",
        "source": "aichart_candle_warehouse",
        "is_closed": True,
    }
    value.update(overrides)
    return value


def test_loads_bounded_closed_warehouse_export() -> None:
    result = load_aichart_candle_warehouse(envelope(row()))
    assert result.quality.row_count == 1
    assert result.quality.end_time == datetime(2025, 1, 6, 9, 0, tzinfo=UTC)
    assert result.quality.source == "aichart_candle_warehouse"


def test_rejects_unclosed_or_future_closing_warehouse_bar() -> None:
    with pytest.raises(DatasetInputError, match="not marked closed"):
        load_aichart_candle_warehouse(envelope(row(is_closed=False)))
    with pytest.raises(DatasetInputError, match="not closed at export"):
        load_aichart_candle_warehouse(
            envelope(row("2025-01-06T09:30:00Z"), exported_at="2025-01-06T10:00:00Z")
        )


def test_rejects_mixed_source_extra_url_and_row_limit() -> None:
    with pytest.raises(DatasetInputError, match="source"):
        load_aichart_candle_warehouse(envelope(row(source="other")))
    unsafe = envelope(row())
    unsafe["url"] = "https://example.invalid"
    with pytest.raises(DatasetInputError, match="envelope"):
        load_aichart_candle_warehouse(unsafe)
    with pytest.raises(DatasetLimitError, match="row"):
        load_aichart_candle_warehouse(
            envelope(row(), row("2025-01-06T08:00:00Z")),
            limits=DatasetLimits(max_rows=1),
        )


def test_rejects_warehouse_payload_size_before_normalization() -> None:
    unsafe = envelope(row(note="x" * 2000))
    with pytest.raises(DatasetLimitError, match="size"):
        load_aichart_candle_warehouse(
            unsafe,
            limits=DatasetLimits(max_file_bytes=1024),
        )
