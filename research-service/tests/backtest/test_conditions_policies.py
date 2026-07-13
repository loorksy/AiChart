from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.backtest.conditions import ConditionContext, evaluate_condition
from app.backtest.policies import forex_market_open, forex_session
from app.data import CanonicalBar, Timeframe


def _bar(timestamp: datetime, close: str = "1.1000") -> CanonicalBar:
    value = Decimal(close)
    return CanonicalBar(
        timestamp=timestamp,
        open=value,
        high=value + Decimal("0.0010"),
        low=value - Decimal("0.0010"),
        close=value,
        volume=None,
        spread=None,
        symbol="EURUSD",
        timeframe=Timeframe.H1,
        source="fixture",
        timezone="UTC",
    )


def test_higher_timeframe_bar_is_unavailable_until_its_close() -> None:
    bars = {"1h": [_bar(datetime(2026, 1, 5, 8, 0, tzinfo=UTC))]}
    before_close = ConditionContext(bars, datetime(2026, 1, 5, 8, 59, 59, tzinfo=UTC), "1h")
    at_close = ConditionContext(bars, datetime(2026, 1, 5, 9, 0, tzinfo=UTC), "1h")
    assert before_close.index("1h") == -1
    assert at_close.index("1h") == 0


def test_atr_pip_units_and_equal_price_condition_are_supported() -> None:
    bars = {
        "1h": [
            _bar(datetime(2026, 1, 5, 8, 0, tzinfo=UTC), "1.1000"),
            _bar(datetime(2026, 1, 5, 9, 0, tzinfo=UTC), "1.1000"),
            _bar(datetime(2026, 1, 5, 10, 0, tzinfo=UTC), "1.1000"),
        ]
    }
    context = ConditionContext(bars, datetime(2026, 1, 5, 11, 0, tzinfo=UTC), "1h")
    assert evaluate_condition(
        {
            "type": "price_comparison",
            "timeframe": "1h",
            "left": "close",
            "operator": "equal",
            "value": 1.1,
        },
        context,
    )
    assert evaluate_condition(
        {
            "type": "atr_threshold",
            "timeframe": "1h",
            "period": 2,
            "operator": "above",
            "value": 19.0,
            "unit": "pips",
        },
        context,
    )


def test_forex_sessions_follow_dst_and_expose_overlap() -> None:
    winter = datetime(2026, 1, 5, 13, 30, tzinfo=UTC)
    summer = datetime(2026, 7, 6, 12, 30, tzinfo=UTC)
    assert set(forex_session(winter).split("+")) >= {"london", "new_york"}
    assert set(forex_session(summer).split("+")) >= {"london", "new_york"}
    for timestamp in (winter, summer):
        context = ConditionContext({"1h": [_bar(timestamp - timedelta(hours=1))]}, timestamp, "1h")
        assert evaluate_condition(
            {"type": "market_session", "sessions": ["london_new_york_overlap"]},
            context,
        )


def test_forex_weekend_boundary_is_new_york_dst_aware() -> None:
    assert not forex_market_open(datetime(2026, 1, 9, 22, 0, tzinfo=UTC))
    assert forex_market_open(datetime(2026, 1, 11, 22, 0, tzinfo=UTC))
    assert not forex_market_open(datetime(2026, 7, 10, 21, 0, tzinfo=UTC))
    assert forex_market_open(datetime(2026, 7, 12, 21, 0, tzinfo=UTC))
