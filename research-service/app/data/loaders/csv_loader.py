from __future__ import annotations

import csv
from collections.abc import Mapping, Sequence
from pathlib import Path

from app.data.errors import DatasetInputError, DatasetLimitError
from app.data.models import CanonicalBar, DatasetLimits, DatasetValidationResult
from app.data.normalization import CANONICAL_FIELDS, REQUIRED_FIELDS, normalize_bar
from app.data.validation import validate_dataset


def _columns(
    fieldnames: Sequence[str] | None,
    mapping: Mapping[str, str] | None,
) -> dict[str, str]:
    if not fieldnames or any(not name for name in fieldnames):
        raise DatasetInputError("CSV header is required")
    if len(fieldnames) != len(set(fieldnames)):
        raise DatasetInputError("duplicate CSV columns are not allowed")
    if mapping is None:
        unknown = set(fieldnames) - CANONICAL_FIELDS
        if unknown:
            raise DatasetInputError("CSV contains unknown columns without an explicit mapping")
        result = {name: name for name in fieldnames}
    else:
        if set(mapping) - CANONICAL_FIELDS:
            raise DatasetInputError("column mapping contains unknown canonical fields")
        if len(set(mapping.values())) != len(mapping):
            raise DatasetInputError("column mapping source columns must be unique")
        result = dict(mapping)
    if REQUIRED_FIELDS - set(result):
        raise DatasetInputError("CSV is missing required canonical columns")
    if set(result.values()) - set(fieldnames):
        raise DatasetInputError("column mapping references a missing CSV column")
    return result


def load_csv(
    path: Path,
    *,
    allowed_root: Path,
    limits: DatasetLimits | None = None,
    column_mapping: Mapping[str, str] | None = None,
) -> DatasetValidationResult:
    from app.data.registry import resolve_controlled_path

    resolved_limits = limits or DatasetLimits()
    controlled = resolve_controlled_path(
        path,
        allowed_root=allowed_root,
        max_file_bytes=resolved_limits.max_file_bytes,
        allowed_suffixes=frozenset({".csv"}),
    )
    bars: list[CanonicalBar] = []
    try:
        with controlled.open("r", encoding="utf-8-sig", errors="strict", newline="") as handle:
            reader = csv.DictReader(handle)
            columns = _columns(reader.fieldnames, column_mapping)
            for row_number, row in enumerate(reader, start=2):
                if len(bars) >= resolved_limits.max_rows:
                    raise DatasetLimitError("dataset row limit exceeded")
                if None in row:
                    raise DatasetInputError(f"malformed CSV row {row_number}")
                raw = {canonical: row[source] for canonical, source in columns.items()}
                try:
                    bars.append(normalize_bar(raw))
                except DatasetInputError as exc:
                    raise DatasetInputError(f"invalid CSV row {row_number}: {exc}") from exc
    except UnicodeDecodeError as exc:
        raise DatasetInputError("CSV must use UTF-8 encoding") from exc
    return validate_dataset(tuple(bars), limits=resolved_limits)
