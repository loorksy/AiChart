from __future__ import annotations

import copy
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from app.data import CanonicalBar, Timeframe, validate_dataset
from app.strategies import parse_strategy_specification


@pytest.fixture
def simple_strategy_payload() -> dict[str, Any]:
    return {
        "strategy_id": "strat.engine.fixture",
        "version_id": "ver.engine.fixture.1",
        "name": "Engine fixture",
        "description": "Deterministic engine fixture",
        "market": "forex",
        "symbols": ["EURUSD"],
        "enabled": True,
        "created_at": "2026-01-01T00:00:00Z",
        "spec_version": "1.0.0",
        "timeframes": {"entry": "15m", "higher": []},
        "direction": "long",
        "entry_conditions": {
            "all": [
                {
                    "type": "price_comparison",
                    "timeframe": "15m",
                    "left": "close",
                    "operator": "above",
                    "value": 0.9,
                }
            ]
        },
        "entry": {
            "order_type": "market",
            "price_reference": "next_bar_open",
            "offset_type": "none",
            "offset_value": 0.0,
            "valid_for_bars": 1,
            "cancel_on_opposite_signal": True,
            "allow_reentry": False,
            "cooldown_bars": 0,
        },
        "stop_loss": {"type": "fixed_pips", "value": 5.0},
        "targets": [
            {"type": "risk_reward", "size_percent": 50.0, "value": 1.0},
            {"type": "risk_reward", "size_percent": 50.0, "value": 2.0},
        ],
        "position_sizing": {
            "type": "risk_percent",
            "risk_percent": 1.0,
            "account_currency": "USD",
        },
        "management": {
            "move_to_break_even": None,
            "trailing_stop": None,
            "maximum_holding_bars": 20,
            "close_on_opposite_signal": False,
            "session_close_exit": False,
        },
        "risk_controls": {
            "max_open_positions": 1,
            "max_positions_per_symbol": 1,
            "max_daily_loss_percent": 10.0,
            "max_consecutive_losses": 5,
            "cooldown_after_loss_bars": 1,
            "daily_trade_limit": 5,
            "minimum_reward_risk": 1.0,
        },
        "costs": {
            "spread": {"type": "fixed_pips", "value": 0.0},
            "slippage": {"type": "none"},
            "commission": {"type": "none"},
            "swap_or_carry": {"type": "none", "require_accurate": False},
        },
    }


@pytest.fixture
def simple_strategy(simple_strategy_payload: dict[str, Any]):
    return parse_strategy_specification(copy.deepcopy(simple_strategy_payload))


@pytest.fixture
def rising_dataset():
    start = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    values = [
        (1.0000, 1.0002, 0.9998, 1.0000),
        (1.0000, 1.0006, 0.9998, 1.0005),
        (1.0006, 1.0012, 1.0004, 1.0010),
        (1.0010, 1.0012, 1.0008, 1.0011),
    ]
    bars = tuple(
        CanonicalBar(
            timestamp=start + timedelta(minutes=15 * index),
            open=Decimal(str(open_)),
            high=Decimal(str(high)),
            low=Decimal(str(low)),
            close=Decimal(str(close)),
            volume=Decimal("100"),
            spread=Decimal("0"),
            symbol="EURUSD",
            timeframe=Timeframe.M15,
            source="fixture",
            timezone="UTC",
        )
        for index, (open_, high, low, close) in enumerate(values)
    )
    return validate_dataset(bars).dataset
