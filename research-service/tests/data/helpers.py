from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.data.models import CanonicalBar
from app.data.normalization import normalize_bar


def make_bar(timestamp: datetime | None = None, **overrides: Any) -> CanonicalBar:
    raw: dict[str, object] = {
        "timestamp": timestamp or datetime(2025, 1, 6, 9, 0, tzinfo=UTC),
        "open": "1.1000",
        "high": "1.1020",
        "low": "1.0990",
        "close": "1.1010",
        "volume": "100",
        "spread": "0.0002",
        "symbol": "EURUSD",
        "timeframe": "15m",
        "source": "fixture",
    }
    raw.update(overrides)
    return normalize_bar(raw)
