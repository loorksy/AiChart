from __future__ import annotations

from pathlib import Path

import pytest

from app.data.errors import DatasetInputError, DatasetLimitError, DatasetPathError
from app.data.loaders.csv_loader import load_csv
from app.data.models import DatasetLimits
from app.data.registry import DatasetFormat, DatasetLoaderRegistry, resolve_controlled_path

HEADER = "timestamp,open,high,low,close,volume,spread,symbol,timeframe,source\n"
ROW = "2025-01-06T09:00:00Z,1.1,1.2,1.0,1.15,100,0.0002,EURUSD,15m,csv_fixture\n"


def test_loads_canonical_csv_from_authorized_root(tmp_path: Path) -> None:
    source = tmp_path / "bars.csv"
    source.write_text(HEADER + ROW, encoding="utf-8")
    result = load_csv(source.resolve(), allowed_root=tmp_path.resolve())
    assert result.quality.row_count == 1
    assert result.dataset.bars[0].symbol == "EURUSD"
    assert result.quality.source == "csv_fixture"


def test_csv_explicit_column_mapping(tmp_path: Path) -> None:
    source = tmp_path / "mapped.csv"
    source.write_text(
        "time,o,h,l,c,v,s,pair,tf,feed,ignored\n"
        "2025-01-06T09:00:00Z,1.1,1.2,1.0,1.15,100,0.0002,EURUSD,15m,mapped,x\n",
        encoding="utf-8",
    )
    mapping = {
        "timestamp": "time",
        "open": "o",
        "high": "h",
        "low": "l",
        "close": "c",
        "volume": "v",
        "spread": "s",
        "symbol": "pair",
        "timeframe": "tf",
        "source": "feed",
    }
    result = load_csv(source, allowed_root=tmp_path, column_mapping=mapping)
    assert result.quality.source == "mapped"


@pytest.mark.parametrize(
    "path",
    [Path("../escape.csv"), Path("https://example.invalid/bars.csv"), Path("file:bars.csv")],
)
def test_controlled_path_rejects_traversal_and_urls(tmp_path: Path, path: Path) -> None:
    with pytest.raises(DatasetPathError):
        resolve_controlled_path(
            path,
            allowed_root=tmp_path,
            max_file_bytes=1024,
            allowed_suffixes=frozenset({".csv"}),
        )


def test_controlled_path_rejects_outside_root_and_wrong_extension(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside.csv"
    outside.write_text(HEADER + ROW, encoding="utf-8")
    wrong = tmp_path / "bars.txt"
    wrong.write_text(HEADER + ROW, encoding="utf-8")
    with pytest.raises(DatasetPathError, match="outside"):
        resolve_controlled_path(
            outside,
            allowed_root=tmp_path,
            max_file_bytes=4096,
            allowed_suffixes=frozenset({".csv"}),
        )
    with pytest.raises(DatasetPathError, match="extension"):
        resolve_controlled_path(
            wrong,
            allowed_root=tmp_path,
            max_file_bytes=4096,
            allowed_suffixes=frozenset({".csv"}),
        )


def test_csv_rejects_rows_and_file_over_limits(tmp_path: Path) -> None:
    source = tmp_path / "bars.csv"
    source.write_text(HEADER + ROW + ROW.replace("09:00", "09:15"), encoding="utf-8")
    with pytest.raises(DatasetLimitError, match="row"):
        load_csv(source, allowed_root=tmp_path, limits=DatasetLimits(max_rows=1))
    oversized = tmp_path / "oversized.csv"
    oversized.write_text(HEADER + ROW + ("x" * 2048), encoding="utf-8")
    with pytest.raises(DatasetLimitError, match="size"):
        load_csv(
            oversized,
            allowed_root=tmp_path,
            limits=DatasetLimits(max_file_bytes=1024),
        )


def test_csv_rejects_unknown_columns_and_locale_numeric_values(tmp_path: Path) -> None:
    unknown = tmp_path / "unknown.csv"
    unknown.write_text(HEADER.rstrip() + ",url\n" + ROW.rstrip() + ",https://x\n", encoding="utf-8")
    with pytest.raises(DatasetInputError, match="unknown"):
        load_csv(unknown, allowed_root=tmp_path)
    locale = tmp_path / "locale.csv"
    locale.write_text(HEADER + ROW.replace("1.1,", '"1,1",'), encoding="utf-8")
    with pytest.raises(DatasetInputError, match="locale"):
        load_csv(locale, allowed_root=tmp_path)


def test_closed_registry_has_no_dynamic_or_url_loader(tmp_path: Path) -> None:
    source = tmp_path / "bars.csv"
    source.write_text(HEADER + ROW, encoding="utf-8")
    registry = DatasetLoaderRegistry(max_file_bytes=4096)
    result = registry.load(DatasetFormat.CSV, source, allowed_root=tmp_path)
    assert result.quality.row_count == 1
