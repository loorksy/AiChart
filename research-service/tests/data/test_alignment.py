from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.data.alignment import ClosedBarAligner, align_closed_bars
from app.data.models import Timeframe
from data.helpers import make_bar


@pytest.fixture
def bar_factory():
    return make_bar


def test_unfinished_htf_is_hidden_and_exact_close_boundary_is_available(bar_factory) -> None:
    nine = bar_factory(datetime(2025, 1, 6, 9, 0, tzinfo=UTC), timeframe="1h")
    ten = bar_factory(datetime(2025, 1, 6, 10, 0, tzinfo=UTC), timeframe="1h")
    aligner = ClosedBarAligner((nine, ten))
    assert aligner.last_closed_at(datetime(2025, 1, 6, 9, 59, tzinfo=UTC)) is None
    assert aligner.last_closed_at(datetime(2025, 1, 6, 10, 0, tzinfo=UTC)) == nine
    assert aligner.last_closed_at(datetime(2025, 1, 6, 10, 45, tzinfo=UTC)) == nine
    assert aligner.last_closed_at(datetime(2025, 1, 6, 11, 0, tzinfo=UTC)) == ten


def test_daily_bar_requires_full_day_close(bar_factory) -> None:
    daily = bar_factory(datetime(2025, 1, 5, 0, 0, tzinfo=UTC), timeframe="1d")
    aligner = ClosedBarAligner((daily,))
    assert aligner.last_closed_at(datetime(2025, 1, 5, 23, 59, tzinfo=UTC)) is None
    assert aligner.last_closed_at(datetime(2025, 1, 6, 0, 0, tzinfo=UTC)) == daily


def test_weekend_and_missing_htf_use_only_last_actually_closed_bar(bar_factory) -> None:
    friday = bar_factory(datetime(2025, 1, 3, 16, 0, tzinfo=UTC), timeframe="1h")
    monday = bar_factory(datetime(2025, 1, 6, 8, 0, tzinfo=UTC), timeframe="1h")
    aligner = ClosedBarAligner((friday, monday))
    assert aligner.last_closed_at(datetime(2025, 1, 5, 12, 0, tzinfo=UTC)) == friday
    assert aligner.last_closed_at(datetime(2025, 1, 6, 8, 30, tzinfo=UTC)) == friday
    assert aligner.last_closed_at(datetime(2025, 1, 6, 9, 0, tzinfo=UTC)) == monday


def test_alignment_is_utc_stable_across_dst_offsets(bar_factory) -> None:
    before = bar_factory(datetime(2025, 3, 9, 6, 0, tzinfo=UTC), timeframe="1h")
    after = bar_factory(datetime(2025, 3, 9, 7, 0, tzinfo=UTC), timeframe="1h")
    aligner = ClosedBarAligner((before, after))
    # 03:00 after the New York spring-forward is 07:00 UTC.
    at_boundary = datetime.fromisoformat("2025-03-09T03:00:00-04:00")
    assert aligner.last_closed_at(at_boundary) == before
    assert aligner.last_closed_at(at_boundary + timedelta(hours=1)) == after


def test_multi_timeframe_alignment_checks_registry_identity(bar_factory) -> None:
    hourly = bar_factory(datetime(2025, 1, 6, 9, 0, tzinfo=UTC), timeframe="1h")
    result = align_closed_bars(
        datetime(2025, 1, 6, 10, 0, tzinfo=UTC),
        symbol="EURUSD",
        higher_timeframes={Timeframe.H1: (hourly,)},
    )
    assert result == {Timeframe.H1: hourly}
