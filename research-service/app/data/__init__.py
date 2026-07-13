"""Strict, deterministic historical market-data contracts."""

from app.data.alignment import ClosedBarAligner, align_closed_bars
from app.data.models import (
    CanonicalBar,
    CanonicalDataset,
    DatasetLimits,
    DatasetQualityReport,
    DatasetValidationResult,
    GapRecord,
    Timeframe,
)
from app.data.validation import validate_dataset

__all__ = [
    "CanonicalBar",
    "CanonicalDataset",
    "ClosedBarAligner",
    "DatasetLimits",
    "DatasetQualityReport",
    "DatasetValidationResult",
    "GapRecord",
    "Timeframe",
    "align_closed_bars",
    "validate_dataset",
]
