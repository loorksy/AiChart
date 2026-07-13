from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import ValidationError

from app.data.errors import DatasetInputError, DatasetLimitError
from app.data.models import CanonicalBar, Timeframe

_SYMBOL_SEPARATORS = r"[/_.-]"
_SYMBOL = r"^[A-Z]{6}$"

CANONICAL_FIELDS = frozenset(CanonicalBar.model_fields)
REQUIRED_FIELDS = frozenset(
    {
        "timestamp",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "spread",
        "symbol",
        "timeframe",
        "source",
    }
)
DECIMAL_FIELDS = frozenset(
    {
        "open",
        "high",
        "low",
        "close",
        "volume",
        "spread",
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
    }
)


def normalize_symbol(value: object) -> str:
    if not isinstance(value, str):
        raise DatasetInputError("symbol must be a string")
    normalized = re.sub(_SYMBOL_SEPARATORS, "", value.strip().upper())
    if not re.fullmatch(_SYMBOL, normalized):
        raise DatasetInputError("symbol must be a normalized six-character Forex/XAUUSD symbol")
    return normalized


def _parse_local_timestamp(value: datetime, timezone_hint: str) -> datetime:
    try:
        zone = ZoneInfo(timezone_hint)
    except ZoneInfoNotFoundError as exc:
        raise DatasetInputError("unknown timezone") from exc
    candidates: set[datetime] = set()
    for fold in (0, 1):
        localized = value.replace(tzinfo=zone, fold=fold)
        utc_value = localized.astimezone(UTC)
        if utc_value.astimezone(zone).replace(tzinfo=None) == value:
            candidates.add(utc_value)
    if not candidates:
        raise DatasetInputError("local timestamp does not exist because of a DST transition")
    if len(candidates) > 1:
        raise DatasetInputError("ambiguous local timestamp requires an explicit UTC offset")
    return candidates.pop()


def normalize_timestamp(value: object, timezone_hint: str | None = None) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        raw = value.strip()
        if not raw:
            raise DatasetInputError("timestamp cannot be empty")
        try:
            parsed = datetime.fromisoformat(raw[:-1] + "+00:00" if raw.endswith("Z") else raw)
        except ValueError as exc:
            raise DatasetInputError("timestamp must use ISO-8601") from exc
    else:
        raise DatasetInputError("timestamp must be an ISO-8601 string or datetime")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        if not timezone_hint:
            raise DatasetInputError("naive timestamp requires an IANA timezone")
        return _parse_local_timestamp(parsed, timezone_hint)
    return parsed.astimezone(UTC)


def normalize_decimal(value: object, *, nullable: bool) -> Decimal | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        if nullable:
            return None
        raise DatasetInputError("required numeric value is missing")
    if isinstance(value, bool) or not isinstance(value, Decimal | int | float | str):
        raise DatasetInputError("numeric values must be decimal-compatible scalars")
    if isinstance(value, str) and "," in value:
        raise DatasetInputError("locale decimal separators are not supported")
    try:
        result = value if isinstance(value, Decimal) else Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise DatasetInputError("invalid decimal value") from exc
    if not result.is_finite():
        raise DatasetInputError("numeric values must be finite")
    return result


def normalize_bar(raw: Mapping[str, object]) -> CanonicalBar:
    keys = frozenset(str(key) for key in raw)
    unknown = keys - CANONICAL_FIELDS
    missing = REQUIRED_FIELDS - keys
    if unknown:
        raise DatasetInputError("unknown canonical bar fields")
    if missing:
        raise DatasetInputError("required canonical bar fields are missing")
    timezone_value = raw.get("timezone")
    if timezone_value is not None and not isinstance(timezone_value, str):
        raise DatasetInputError("timezone must be an IANA timezone string")
    values: dict[str, Any] = dict(raw)
    values["timestamp"] = normalize_timestamp(raw["timestamp"], timezone_value)
    values["symbol"] = normalize_symbol(raw["symbol"])
    raw_timeframe = raw["timeframe"]
    if not isinstance(raw_timeframe, str):
        raise DatasetInputError("timeframe must be a string")
    try:
        values["timeframe"] = Timeframe(raw_timeframe)
    except (TypeError, ValueError) as exc:
        raise DatasetInputError("unsupported timeframe") from exc
    if not isinstance(raw["source"], str):
        raise DatasetInputError("source must be a string")
    values["source"] = raw["source"].strip()
    for field in DECIMAL_FIELDS:
        if field in values:
            values[field] = normalize_decimal(
                values[field], nullable=field not in {"open", "high", "low", "close"}
            )
    try:
        return CanonicalBar.model_validate(values)
    except ValidationError as exc:
        raise DatasetInputError("invalid canonical bar") from exc


def normalize_rows(
    rows: list[Mapping[str, object]] | tuple[Mapping[str, object], ...],
    *,
    max_rows: int,
) -> tuple[CanonicalBar, ...]:
    if len(rows) > max_rows:
        raise DatasetLimitError("dataset row limit exceeded")
    normalized: list[CanonicalBar] = []
    for index, raw in enumerate(rows, start=1):
        try:
            normalized.append(normalize_bar(raw))
        except DatasetInputError as exc:
            raise DatasetInputError(f"invalid dataset row {index}: {exc}") from exc
    return tuple(normalized)
