from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from app.data.errors import DatasetDependencyUnavailable, DatasetInputError, DatasetLimitError
from app.data.models import CanonicalBar, DatasetLimits, DatasetValidationResult
from app.data.normalization import CANONICAL_FIELDS, REQUIRED_FIELDS, normalize_bar
from app.data.validation import validate_dataset


def _columns(names: list[str], mapping: Mapping[str, str] | None) -> dict[str, str]:
    if len(names) != len(set(names)):
        raise DatasetInputError("duplicate Parquet columns are not allowed")
    if mapping is None:
        if set(names) - CANONICAL_FIELDS:
            raise DatasetInputError("Parquet contains unknown columns without an explicit mapping")
        result = {name: name for name in names}
    else:
        if set(mapping) - CANONICAL_FIELDS:
            raise DatasetInputError("column mapping contains unknown canonical fields")
        if len(set(mapping.values())) != len(mapping):
            raise DatasetInputError("column mapping source columns must be unique")
        result = dict(mapping)
    if REQUIRED_FIELDS - set(result):
        raise DatasetInputError("Parquet is missing required canonical columns")
    if set(result.values()) - set(names):
        raise DatasetInputError("column mapping references a missing Parquet column")
    return result


def load_parquet(
    path: Path,
    *,
    allowed_root: Path,
    limits: DatasetLimits | None = None,
    column_mapping: Mapping[str, str] | None = None,
) -> DatasetValidationResult:
    """Load bounded scalar Parquet data; PyArrow is imported only on this path."""

    from app.data.registry import resolve_controlled_path

    resolved_limits = limits or DatasetLimits()
    controlled = resolve_controlled_path(
        path,
        allowed_root=allowed_root,
        max_file_bytes=resolved_limits.max_file_bytes,
        allowed_suffixes=frozenset({".parquet"}),
    )
    try:
        import pyarrow as pa  # type: ignore[import-not-found]
        import pyarrow.parquet as pq  # type: ignore[import-not-found]
        from pyarrow.lib import ArrowException  # type: ignore[import-not-found]
    except ImportError as exc:
        raise DatasetDependencyUnavailable("Parquet support requires pinned PyArrow") from exc

    try:
        parquet = pq.ParquetFile(controlled)
    except (OSError, ValueError, ArrowException) as exc:
        raise DatasetInputError("malformed Parquet artifact") from exc
    if parquet.metadata.num_rows > resolved_limits.max_rows:
        raise DatasetLimitError("dataset row limit exceeded")
    schema = parquet.schema_arrow

    def allowed_type(value: Any) -> bool:
        return bool(
            pa.types.is_string(value)
            or pa.types.is_integer(value)
            or pa.types.is_floating(value)
            or pa.types.is_decimal(value)
            or pa.types.is_timestamp(value)
        )

    if any(not allowed_type(field.type) for field in schema):
        raise DatasetInputError("nested or unsupported Parquet column type")
    columns = _columns(schema.names, column_mapping)
    bars: list[CanonicalBar] = []
    try:
        batches = parquet.iter_batches(
            batch_size=resolved_limits.parquet_batch_rows,
            columns=list(columns.values()),
            use_threads=False,
        )
        for batch in batches:
            for row in batch.to_pylist():
                if len(bars) >= resolved_limits.max_rows:
                    raise DatasetLimitError("dataset row limit exceeded")
                raw: dict[str, Any] = {
                    canonical: row[source] for canonical, source in columns.items()
                }
                bars.append(normalize_bar(raw))
    except DatasetLimitError:
        raise
    except (OSError, ValueError, ArrowException) as exc:
        raise DatasetInputError("invalid Parquet data") from exc
    return validate_dataset(tuple(bars), limits=resolved_limits)
