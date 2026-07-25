"""A real backtest must produce the SAME result through process isolation.

Process isolation is only safe if crossing the pickle boundary changes nothing:
the engine is rebuilt in the child from the raw spec, so determinism must hold
end-to-end (RELIABILITY_PLAN item 3).
"""

from __future__ import annotations

import pytest

from app.backtest import BacktestEngine, RunConfig
from app.jobs.backtest_process import run_backtest_in_child
from app.jobs.process_worker import run_in_killable_process

pytestmark = pytest.mark.asyncio


async def test_child_process_run_matches_in_process_run(
    simple_strategy, rising_dataset
) -> None:
    config = RunConfig(initial_capital=10_000.0, account_currency="USD")

    # Baseline: the normal in-process run.
    expected = await BacktestEngine(simple_strategy, rising_dataset, config).run()

    # Same inputs, executed inside a killable child process.
    actual = await run_in_killable_process(
        run_backtest_in_child,
        simple_strategy,
        rising_dataset,
        config,
        timeout_seconds=120,
    )

    assert actual.strategy_hash == expected.strategy_hash
    assert actual.dataset_hash == expected.dataset_hash
    assert actual.final_balance == expected.final_balance
    assert len(actual.trades) == len(expected.trades)
    assert actual.metrics == expected.metrics
    assert [t.net_pnl for t in actual.trades] == [t.net_pnl for t in expected.trades]


async def test_engine_retains_raw_spec_for_child_rebuild(
    simple_strategy, rising_dataset
) -> None:
    """The process path rebuilds from `strategy_input`; it must be the RAW spec."""
    engine = BacktestEngine(
        simple_strategy, rising_dataset, RunConfig(initial_capital=10_000.0, account_currency="USD")
    )
    assert engine.strategy_input is simple_strategy
