from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import Field, ValidationError

from app.data.errors import DatasetInputError, DatasetLimitError
from app.data.models import (
    TIMEFRAME_SECONDS,
    DatasetLimits,
    DatasetValidationResult,
    StrictDataModel,
)
from app.data.normalization import normalize_bar, normalize_timestamp
from app.data.validation import validate_dataset


class WarehouseExportEnvelope(StrictDataModel):
    schema_version: Literal["aichart-candle-warehouse-v1"]
    source: Literal["aichart_candle_warehouse"]
    exported_at: datetime
    closed_bars_only: Literal[True]
    bars: tuple[dict[str, Any], ...] = Field(min_length=1)


def load_aichart_candle_warehouse(
    payload: Mapping[str, object],
    *,
    limits: DatasetLimits | None = None,
) -> DatasetValidationResult:
    """Load a bounded, server-produced warehouse export; no DB or network access occurs."""

    resolved_limits = limits or DatasetLimits()
    try:
        encoded_size = len(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).encode(
                "utf-8"
            )
        )
    except (TypeError, ValueError) as exc:
        raise DatasetInputError("warehouse export is not JSON-compatible") from exc
    if encoded_size > resolved_limits.max_file_bytes:
        raise DatasetLimitError("warehouse export size limit exceeded")
    raw_bars = payload.get("bars")
    if not isinstance(raw_bars, list | tuple):
        raise DatasetInputError("warehouse export bars must be an array")
    if len(raw_bars) > resolved_limits.max_rows:
        raise DatasetLimitError("dataset row limit exceeded")
    prepared = dict(payload)
    prepared["bars"] = tuple(raw_bars)
    prepared["exported_at"] = normalize_timestamp(payload.get("exported_at"))
    try:
        envelope = WarehouseExportEnvelope.model_validate(prepared)
    except ValidationError as exc:
        raise DatasetInputError("invalid AiChart candle warehouse export envelope") from exc
    exported_at = envelope.exported_at.astimezone(UTC)
    bars = []
    for row_number, item in enumerate(envelope.bars, start=1):
        if item.get("is_closed") is not True:
            raise DatasetInputError(f"warehouse row {row_number} is not marked closed")
        raw = {key: value for key, value in item.items() if key != "is_closed"}
        if raw.get("source") != envelope.source:
            raise DatasetInputError("warehouse row source does not match its export")
        try:
            bar = normalize_bar(raw)
        except DatasetInputError as exc:
            raise DatasetInputError(f"invalid warehouse row {row_number}: {exc}") from exc
        closed_at = bar.timestamp + timedelta(seconds=TIMEFRAME_SECONDS[bar.timeframe])
        if closed_at > exported_at:
            raise DatasetInputError(f"warehouse row {row_number} was not closed at export time")
        bars.append(bar)
    return validate_dataset(tuple(bars), limits=resolved_limits, run_end=exported_at)
