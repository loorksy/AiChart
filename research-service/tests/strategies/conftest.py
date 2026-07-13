from __future__ import annotations

import copy
from collections.abc import Callable
from typing import Any

import pytest


@pytest.fixture
def valid_strategy_payload() -> dict[str, Any]:
    return {
        "strategy_id": "strat.fx.ema",
        "version_id": "ver.fx.ema.1",
        "name": "EMA continuation",
        "description": "Deterministic close signal with next-bar execution.",
        "market": "forex",
        "symbols": ["EUR/USD", "XAU_USD"],
        "enabled": True,
        "created_at": "2026-07-13T10:00:00Z",
        "spec_version": "1.0.0",
        "timeframes": {"entry": "15m", "higher": ["1h", "4h"]},
        "direction": "long",
        "entry_conditions": {
            "all": [
                {
                    "type": "ema_relation",
                    "timeframe": "1h",
                    "fast_period": 20,
                    "slow_period": 50,
                    "operator": "above",
                },
                {
                    "type": "rsi_threshold",
                    "timeframe": "15m",
                    "period": 14,
                    "operator": "crosses_above",
                    "value": 50.0,
                },
                {"type": "market_session", "sessions": ["london", "new_york"]},
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
            "cooldown_bars": 3,
        },
        "stop_loss": {"type": "fixed_pips", "value": 30.0},
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
            "move_to_break_even": {
                "trigger_type": "r_multiple",
                "trigger_value": 1.0,
                "new_stop_offset_pips": 0.0,
            },
            "trailing_stop": {
                "type": "atr_multiple",
                "value": 2.0,
                "activation_r": 1.0,
                "update_every_bars": 1,
                "activation_timing": "next_bar",
                "price_basis": "close",
                "tightening_only": True,
            },
            "maximum_holding_bars": 100,
            "close_on_opposite_signal": True,
            "session_close_exit": False,
        },
        "risk_controls": {
            "max_open_positions": 3,
            "max_positions_per_symbol": 1,
            "max_daily_loss_percent": 3.0,
            "max_consecutive_losses": 4,
            "cooldown_after_loss_bars": 5,
            "daily_trade_limit": 6,
            "minimum_reward_risk": 1.0,
        },
        "costs": {
            "spread": {"type": "fixed_pips", "value": 1.0},
            "slippage": {"type": "none"},
            "commission": {"type": "per_lot_per_side", "value": 3.5, "currency": "USD"},
            "swap_or_carry": {"type": "none", "require_accurate": False},
        },
    }


@pytest.fixture
def payload_copy(valid_strategy_payload: dict[str, Any]) -> Callable[[], dict[str, Any]]:
    return lambda: copy.deepcopy(valid_strategy_payload)
