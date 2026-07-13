from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.data.errors import DatasetInputError
from app.data.hashing import dataset_hash
from app.data.models import CanonicalBar
from app.data.normalization import normalize_bar, normalize_timestamp
from app.data.validation import validate_dataset
from data.helpers import make_bar


@pytest.fixture
def bar_factory():
    return make_bar


def test_normalizes_symbol_offset_timestamp_and_decimal(bar_factory) -> None:
    bar = bar_factory(
        timestamp="2025-01-06T11:00:00+02:00",
        symbol="eur/usd",
        open="1.10000",
    )
    assert bar.timestamp == datetime(2025, 1, 6, 9, 0, tzinfo=UTC)
    assert bar.symbol == "EURUSD"
    assert bar.open == Decimal("1.10000")


def test_strict_canonical_model_rejects_uncontrolled_float(bar_factory) -> None:
    valid = bar_factory()
    raw = valid.model_dump()
    raw["open"] = 1.1
    with pytest.raises(ValidationError):
        CanonicalBar.model_validate(raw)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"high": "1.09"}, "invalid canonical bar"),
        ({"open": "NaN"}, "finite"),
        ({"close": "Infinity"}, "finite"),
        ({"spread": "-0.1"}, "invalid canonical bar"),
        ({"timeframe": "2m"}, "unsupported timeframe"),
    ],
)
def test_rejects_invalid_ohlc_non_finite_spread_and_timeframe(
    bar_factory, overrides, message
) -> None:
    with pytest.raises(DatasetInputError, match=message):
        bar_factory(**overrides)


def test_missing_spread_and_volume_are_reported_as_zero_coverage(bar_factory) -> None:
    result = validate_dataset((bar_factory(spread="", volume=None),))
    assert result.quality.spread_coverage == 0
    assert result.quality.volume_coverage == 0


def test_rejects_duplicate_unordered_and_mixed_source(bar_factory) -> None:
    first = bar_factory()
    later = bar_factory(first.timestamp + timedelta(minutes=15))
    with pytest.raises(DatasetInputError, match="duplicate"):
        validate_dataset((first, first))
    with pytest.raises(DatasetInputError, match="strictly increasing"):
        validate_dataset((later, first))
    with pytest.raises(DatasetInputError, match="mixed"):
        validate_dataset((first, bar_factory(later.timestamp, source="other")))


def test_series_order_is_independent_per_symbol_and_gaps_are_reported(bar_factory) -> None:
    start = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)
    bars = (
        bar_factory(start, symbol="EURUSD"),
        bar_factory(start, symbol="GBPUSD"),
        bar_factory(start + timedelta(minutes=45), symbol="EURUSD"),
        bar_factory(start + timedelta(minutes=15), symbol="GBPUSD"),
    )
    result = validate_dataset(bars)
    assert result.quality.row_count == 4
    assert result.quality.missing_intervals == 2
    assert result.quality.largest_gap == 2700
    assert len(result.gaps) == 1


def test_hash_is_stable_for_equivalent_normalized_values_and_input_order(bar_factory) -> None:
    start = datetime(2025, 1, 6, 9, 0, tzinfo=UTC)
    eur_a = bar_factory(start, open="1.1000")
    eur_b = bar_factory(start, open="1.1")
    gbp = bar_factory(start, symbol="GBPUSD")
    assert dataset_hash((eur_a, gbp)) == dataset_hash((gbp, eur_b))


def test_timezone_normalization_rejects_ambiguous_and_nonexistent_dst() -> None:
    with pytest.raises(DatasetInputError, match="does not exist"):
        normalize_timestamp("2025-03-09T02:30:00", "America/New_York")
    with pytest.raises(DatasetInputError, match="ambiguous"):
        normalize_timestamp("2025-11-02T01:30:00", "America/New_York")
    assert normalize_timestamp("2025-03-09T03:30:00", "America/New_York") == datetime(
        2025, 3, 9, 7, 30, tzinfo=UTC
    )


def test_normalizer_rejects_unknown_fields_and_locale_decimal() -> None:
    raw = {
        "timestamp": "2025-01-01T00:00:00Z",
        "open": "1,10",
        "high": "1.2",
        "low": "1.0",
        "close": "1.1",
        "volume": "1",
        "spread": "0",
        "symbol": "EURUSD",
        "timeframe": "1h",
        "source": "fixture",
        "url": "https://example.invalid",
    }
    with pytest.raises(DatasetInputError, match="unknown"):
        normalize_bar(raw)
