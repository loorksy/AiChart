from __future__ import annotations

from pathlib import Path

import pytest

from app.data.loaders.parquet_loader import load_parquet


def test_parquet_loader_reads_canonical_scalar_columns(tmp_path: Path) -> None:
    pyarrow = pytest.importorskip("pyarrow")
    parquet = pytest.importorskip("pyarrow.parquet")
    table = pyarrow.table(
        {
            "timestamp": ["2025-01-06T09:00:00Z"],
            "open": ["1.1"],
            "high": ["1.2"],
            "low": ["1.0"],
            "close": ["1.15"],
            "volume": ["100"],
            "spread": ["0.0002"],
            "symbol": ["EURUSD"],
            "timeframe": ["15m"],
            "source": ["parquet_fixture"],
        }
    )
    path = tmp_path / "bars.parquet"
    parquet.write_table(table, path)
    result = load_parquet(path, allowed_root=tmp_path)
    assert result.quality.row_count == 1
    assert result.quality.source == "parquet_fixture"
