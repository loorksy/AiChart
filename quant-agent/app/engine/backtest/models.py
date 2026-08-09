"""Engine-local pydantic types for the backtest package -- not added to
`app/storage/models.py`, matching how `app/engine/combine.py` owns
`CombineResult` rather than putting it in storage. `app/storage/models.py`
still gets its own `BacktestRun`/`BacktestResponse` shapes (the persisted/API
surface), which wrap `BacktestMetrics` below rather than duplicating it."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.engine.strategies.base import Direction


class SimulatedTrade(BaseModel):
    """One resolved (stop-loss or target hit) trade produced by
    `app.engine.backtest.simulate.simulate_trades`. Risk-normalized only --
    no currency/account P&L field exists here on purpose (no capital/leverage
    model exists in quant-agent, see the package's module docstring)."""

    strategy_id: str
    strategy_version: str
    direction: Direction
    entry_step_index: int
    exit_step_index: int
    entry: float
    stop_loss: float
    target: float
    exit_price: float
    outcome: Literal["stop", "target"]
    r_multiple: float


class BacktestMetrics(BaseModel):
    """Trade-level statistics from `app.engine.backtest.metrics`. Every
    metric that cannot be computed for the given trade list is `None`, with
    the reason recorded in `metric_reasons` (never a silently-defaulted 0 or
    NaN)."""

    trade_count: int
    win_rate: float | None = None
    profit_factor: float | None = None
    expectancy_r: float | None = None
    max_drawdown_r: float | None = None
    max_drawdown_percent: float | None = None
    sharpe_r: float | None = None
    metric_reasons: dict[str, str] = Field(default_factory=dict)
