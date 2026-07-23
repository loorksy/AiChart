"""Regression: EMA trend catalog must produce many trades on oscillating history.

Guards against the one-trade-ever failure mode (allow_reentry / entered-symbol
never cleared / permanent consecutive-loss halt) without relying on a live
warehouse backtest.
"""

from __future__ import annotations

import copy
import math
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from app.backtest import BacktestEngine, RunConfig
from app.backtest.policies import forex_market_open
from app.data import CanonicalBar, Timeframe, validate_dataset
from app.strategies import parse_strategy_specification


def _ema_catalog_payload() -> dict[str, Any]:
    """Mirrors web catalog ema_trend_follow_v1 revision-2 entry/exit policy."""
    return {
        "strategy_id": "ema_trend_follow_v1",
        "version_id": "ema_trend_follow_v1.2",
        "name": "EMA trend follow",
        "description": "Fixture mirroring production catalog entry/exit policy",
        "market": "forex",
        "symbols": ["XAUUSD"],
        "enabled": True,
        "created_at": "2026-01-01T00:00:00Z",
        "spec_version": "1.0.0",
        "timeframes": {"entry": "1h", "higher": []},
        "direction": "both",
        "long_entry_conditions": {
            "all": [
                {
                    "type": "ema_relation",
                    "timeframe": "1h",
                    "fast_period": 20,
                    "slow_period": 50,
                    "operator": "crosses_above",
                }
            ]
        },
        "short_entry_conditions": {
            "all": [
                {
                    "type": "ema_relation",
                    "timeframe": "1h",
                    "fast_period": 20,
                    "slow_period": 50,
                    "operator": "crosses_below",
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
            "allow_reentry": True,
            "cooldown_bars": 2,
        },
        "stop_loss": {
            "type": "atr_multiple",
            "value": 1.5,
            "period": 14,
            "timeframe": "1h",
        },
        "targets": [
            {"type": "risk_reward", "size_percent": 50.0, "value": 1.5},
            {"type": "risk_reward", "size_percent": 50.0, "value": 2.5},
        ],
        "position_sizing": {
            "type": "risk_percent",
            "risk_percent": 1.0,
            "account_currency": "USD",
        },
        "management": {
            "move_to_break_even": None,
            "trailing_stop": None,
            "maximum_holding_bars": 18,
            "close_on_opposite_signal": True,
            "session_close_exit": False,
        },
        "risk_controls": {
            "max_open_positions": 1,
            "max_positions_per_symbol": 1,
            "max_consecutive_losses": 25,
            "consecutive_loss_pause_bars": 4,
            "cooldown_after_loss_bars": 1,
            "max_daily_loss_percent": 15.0,
            "daily_trade_limit": 30,
            "minimum_reward_risk": 1.0,
        },
        "costs": {
            "spread": {"type": "fixed_pips", "value": 2.0},
            "slippage": {"type": "fixed_pips", "value": 1.0},
            "commission": {"type": "none"},
            "swap_or_carry": {"type": "none", "require_accurate": False},
        },
    }


def _oscillating_xau_dataset(bar_count: int = 800):
    """Synthetic weekday hour bars with several slow EMA 20/50 crosses."""
    cursor = datetime(2024, 1, 2, 0, 0, tzinfo=UTC)  # Tuesday
    bars = []
    index = 0
    while len(bars) < bar_count:
        # Skip Forex closed hours — engine rejects bars outside market hours.
        if forex_market_open(cursor):
            # ~80-bar half-cycle so EMA20/50 cross multiple times over 800 bars.
            wave = math.sin(index / 40.0) * 40.0
            close = 2000.0 + wave + (index * 0.01)
            open_ = close - 0.4
            high = max(open_, close) + 1.2
            low = min(open_, close) - 1.2
            bars.append(
                CanonicalBar(
                    timestamp=cursor,
                    open=Decimal(str(round(open_, 3))),
                    high=Decimal(str(round(high, 3))),
                    low=Decimal(str(round(low, 3))),
                    close=Decimal(str(round(close, 3))),
                    volume=Decimal("100"),
                    spread=Decimal("0.2"),
                    symbol="XAUUSD",
                    timeframe=Timeframe.H1,
                    source="fixture",
                    timezone="UTC",
                )
            )
            index += 1
        cursor += timedelta(hours=1)
    return validate_dataset(tuple(bars)).dataset


@pytest.mark.asyncio
async def test_ema_catalog_policy_produces_many_trades_on_known_history() -> None:
    dataset = _oscillating_xau_dataset(800)
    strategy = parse_strategy_specification(copy.deepcopy(_ema_catalog_payload()))
    result = await BacktestEngine(
        strategy,
        dataset,
        RunConfig(initial_capital=10_000.0, account_currency="USD", seed=42),
    ).run()

    trade_count = int(result.metrics["trade_count"])
    # Known oscillating fixture must clear well above the historic one-trade bug.
    assert trade_count >= 5, (
        f"expected multiple EMA-cross trades on oscillating fixture, got {trade_count}"
    )
    assert trade_count != 1, "one-trade-ever regression"
    assert int(result.metrics["bars_evaluated"]) == 800


@pytest.mark.asyncio
async def test_allow_reentry_false_without_discard_would_cap_at_one_is_not_current_behavior() -> None:
    """Document intended semantics: allow_reentry=false still re-enters after full close."""
    payload = copy.deepcopy(_ema_catalog_payload())
    payload["entry"]["allow_reentry"] = False
    payload["entry"]["cooldown_bars"] = 0
    payload["risk_controls"]["cooldown_after_loss_bars"] = 0
    dataset = _oscillating_xau_dataset(800)
    strategy = parse_strategy_specification(payload)
    result = await BacktestEngine(
        strategy,
        dataset,
        RunConfig(initial_capital=10_000.0, account_currency="USD", seed=42),
    ).run()
    assert int(result.metrics["trade_count"]) >= 5
