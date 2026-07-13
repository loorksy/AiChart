from __future__ import annotations

import re
from enum import StrEnum
from pathlib import Path

from app.data.errors import DatasetLimitError, DatasetPathError
from app.data.loaders.csv_loader import load_csv
from app.data.loaders.parquet_loader import load_parquet
from app.data.models import DatasetLimits, DatasetValidationResult

_URL = r"^[A-Za-z][A-Za-z0-9+.-]*://"


class DatasetFormat(StrEnum):
    CSV = "csv"
    PARQUET = "parquet"


def resolve_controlled_path(
    path: Path,
    *,
    allowed_root: Path,
    max_file_bytes: int,
    allowed_suffixes: frozenset[str],
) -> Path:
    """Resolve an internal artifact path without accepting URLs or root escapes."""

    if not isinstance(path, Path) or not isinstance(allowed_root, Path):
        raise DatasetPathError("dataset loaders require Path objects")
    rendered = str(path)
    scheme_part = path.parts[0] if path.parts else ""
    if (
        re.match(_URL, rendered)
        or rendered.lower().startswith("file:")
        or (scheme_part.endswith(":") and len(scheme_part) > 2)
    ):
        raise DatasetPathError("dataset URLs are not allowed")
    if ".." in path.parts:
        raise DatasetPathError("dataset path traversal is not allowed")
    root = allowed_root.expanduser().resolve()
    unresolved = path.expanduser() if path.is_absolute() else root / path
    probe = unresolved
    while probe != root and root in probe.parents:
        if probe.is_symlink():
            raise DatasetPathError("symlink dataset paths are not allowed")
        probe = probe.parent
    candidate = unresolved.resolve()
    if candidate == root or root not in candidate.parents:
        raise DatasetPathError("dataset path is outside the authorized artifact root")
    if candidate.suffix.lower() not in allowed_suffixes:
        raise DatasetPathError("unsupported dataset file extension")
    if not candidate.is_file():
        raise DatasetPathError("dataset artifact does not exist")
    if candidate.stat().st_size > max_file_bytes:
        raise DatasetLimitError("dataset file size limit exceeded")
    return candidate


class DatasetLoaderRegistry:
    """Closed registry; loader selection never imports a user-provided module."""

    def __init__(self, *, max_file_bytes: int) -> None:
        self.max_file_bytes = max_file_bytes

    def load(
        self,
        dataset_format: DatasetFormat,
        path: Path,
        *,
        allowed_root: Path,
        limits: DatasetLimits | None = None,
        column_mapping: dict[str, str] | None = None,
    ) -> DatasetValidationResult:
        resolved_limits = limits or DatasetLimits(max_file_bytes=self.max_file_bytes)
        effective_limit = min(self.max_file_bytes, resolved_limits.max_file_bytes)
        if dataset_format == DatasetFormat.CSV:
            controlled = resolve_controlled_path(
                path,
                allowed_root=allowed_root,
                max_file_bytes=effective_limit,
                allowed_suffixes=frozenset({".csv"}),
            )
            return load_csv(
                controlled,
                allowed_root=allowed_root,
                limits=resolved_limits,
                column_mapping=column_mapping,
            )
        if dataset_format == DatasetFormat.PARQUET:
            controlled = resolve_controlled_path(
                path,
                allowed_root=allowed_root,
                max_file_bytes=effective_limit,
                allowed_suffixes=frozenset({".parquet"}),
            )
            return load_parquet(
                controlled,
                allowed_root=allowed_root,
                limits=resolved_limits,
                column_mapping=column_mapping,
            )
        raise DatasetPathError("unsupported dataset format")
