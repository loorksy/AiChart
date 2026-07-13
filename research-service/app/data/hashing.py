from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal

from app.data.models import CanonicalBar


def canonical_decimal(value: Decimal | None) -> str | None:
    if value is None:
        return None
    if value == 0:
        return "0"
    rendered = format(value.normalize(), "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered


def canonical_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _bar_document(bar: CanonicalBar) -> dict[str, object]:
    document: dict[str, object] = {
        "timestamp": canonical_timestamp(bar.timestamp),
        "open": canonical_decimal(bar.open),
        "high": canonical_decimal(bar.high),
        "low": canonical_decimal(bar.low),
        "close": canonical_decimal(bar.close),
        "volume": canonical_decimal(bar.volume),
        "spread": canonical_decimal(bar.spread),
        "symbol": bar.symbol,
        "timeframe": bar.timeframe.value,
        "source": bar.source,
    }
    for field in (
        "bid_open",
        "bid_high",
        "bid_low",
        "bid_close",
        "ask_open",
        "ask_high",
        "ask_low",
        "ask_close",
        "tick_volume",
        "real_volume",
        "timezone",
    ):
        value = getattr(bar, field)
        document[field] = canonical_decimal(value) if isinstance(value, Decimal) else value
    return document


def dataset_hash(bars: tuple[CanonicalBar, ...] | list[CanonicalBar]) -> str:
    """Hash normalized content, independent of input object/key ordering."""

    digest = hashlib.sha256()
    ordered = sorted(bars, key=lambda item: (item.symbol, item.timeframe.value, item.timestamp))
    for bar in ordered:
        encoded = json.dumps(
            _bar_document(bar),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
    return digest.hexdigest()
