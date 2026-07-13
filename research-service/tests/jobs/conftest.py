from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import TOKEN
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def phase3_client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(
        internal_token=TOKEN,
        environment="test",
        work_dir=tmp_path / "work",
        artifact_dir=tmp_path / "artifacts",
        max_concurrent_jobs=1,
        max_queued_jobs=8,
        default_timeout_seconds=5,
        max_timeout_seconds=30,
        max_retries=2,
        max_request_bytes=8 * 1024 * 1024,
        max_artifact_bytes=8 * 1024 * 1024,
    )
    with TestClient(create_app(settings)) as active:
        yield active


@pytest.fixture
def phase3_strategy() -> dict[str, Any]:
    return {
        "strategy_id": "strat.phase3.job",
        "version_id": "ver.phase3.job.1",
        "name": "Phase 3 job fixture",
        "description": "Strict declarative strategy",
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
        "stop_loss": {"type": "fixed_pips", "value": 10.0},
        "targets": [{"type": "risk_reward", "size_percent": 100.0, "value": 2.0}],
        "position_sizing": {"type": "fixed_lot", "lots": 0.01},
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
            "spread": {"type": "fixed_pips", "value": 1.0},
            "slippage": {"type": "none"},
            "commission": {"type": "none"},
            "swap_or_carry": {"type": "none", "require_accurate": False},
        },
    }
