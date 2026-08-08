"""The single entry point the backtest API endpoint calls (plan section 1):
`replay_strategy` -> `simulate_trades` -> `calculate_backtest_metrics`, with
no additional branching of its own."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.engine.backtest.metrics import calculate_backtest_metrics
from app.engine.backtest.models import BacktestMetrics, SimulatedTrade
from app.engine.backtest.replay import replay_strategy
from app.engine.backtest.simulate import simulate_trades
from app.engine.strategies.base import Strategy
from app.engine.strategies.generated_code.contract import (
    BACKTEST_BATCH_TIMEOUT_SECONDS,
    BACKTEST_PER_BAR_TIMEOUT_SECONDS,
)
from app.storage.models import Bar

# Matches `app.config.Settings.min_bars`'s own default -- the live path's
# reliability floor before indicators (EMA200 in particular) are considered
# trustworthy enough to evaluate strategies against. Callers that know their
# configured `min_bars` (the API route, via `Settings`) should pass it
# explicitly; this default only covers ad hoc/test callers.
DEFAULT_MIN_BARS = 210


class BacktestOutcome(BaseModel):
    """Everything one `run_backtest` call produces: how many bars the
    strategy fired on, the resolved trades, and the metrics computed from
    them."""

    fired_count: int
    trades: list[SimulatedTrade] = Field(default_factory=list)
    metrics: BacktestMetrics


def run_backtest(
    strategy: Strategy,
    symbol: str,
    market: str,
    interval: str,
    bars: list[Bar],
    *,
    min_bars: int = DEFAULT_MIN_BARS,
    batch_wall_clock_timeout_seconds: int = BACKTEST_BATCH_TIMEOUT_SECONDS,
    batch_per_bar_timeout_seconds: int = BACKTEST_PER_BAR_TIMEOUT_SECONDS,
) -> BacktestOutcome:
    fired = replay_strategy(
        strategy,
        symbol,
        market,
        interval,
        bars,
        min_bars,
        batch_wall_clock_timeout_seconds=batch_wall_clock_timeout_seconds,
        batch_per_bar_timeout_seconds=batch_per_bar_timeout_seconds,
    )
    trades = simulate_trades(fired, bars)
    metrics = calculate_backtest_metrics(trades)
    return BacktestOutcome(fired_count=len(fired), trades=trades, metrics=metrics)
