from __future__ import annotations

from pathlib import Path

from app.storage.models import BacktestMetrics, BacktestRun, utc_now_iso
from app.storage.sqlite import SqliteQuantStore


def _run(**overrides: object) -> BacktestRun:
    base: dict[str, object] = dict(
        id="qbt_1",
        strategy_id="ema_trend_v1",
        strategy_version="1.0.0",
        symbol="EURUSD",
        market="forex",
        interval="M15",
        bar_count=250,
        from_time="2026-01-01T00:00:00+00:00",
        to_time="2026-01-03T00:00:00+00:00",
        status="completed",
        metrics=BacktestMetrics(
            trade_count=3,
            win_rate=0.667,
            profit_factor=1.5,
            expectancy_r=0.4,
            max_drawdown_r=1.0,
            max_drawdown_percent=20.0,
            sharpe_r=0.8,
            metric_reasons={},
        ),
        warnings=["1 fired signal(s) never resolved before the bar series ended"],
        created_at=utc_now_iso(),
    )
    base.update(overrides)
    return BacktestRun.model_validate(base)


async def test_create_and_get_backtest_run_round_trip(tmp_path: Path) -> None:
    store = SqliteQuantStore(tmp_path / "work" / "quant-agent.sqlite3")
    await store.initialize()

    run = _run()
    stored = await store.create_backtest_run(run)
    assert stored.id == "qbt_1"

    fetched = await store.get_backtest_run("qbt_1")
    assert fetched is not None
    assert fetched.strategy_id == "ema_trend_v1"
    assert fetched.status == "completed"
    assert fetched.metrics is not None
    assert fetched.metrics.trade_count == 3
    assert fetched.metrics.win_rate == 0.667
    assert fetched.metrics.profit_factor == 1.5
    assert fetched.warnings == ["1 fired signal(s) never resolved before the bar series ended"]

    assert await store.get_backtest_run("qbt_missing") is None


async def test_backtest_run_with_no_metrics_round_trips_as_none(tmp_path: Path) -> None:
    store = SqliteQuantStore(tmp_path / "work" / "quant-agent.sqlite3")
    await store.initialize()

    run = _run(id="qbt_2", status="invalid", metrics=None, warnings=[])
    await store.create_backtest_run(run)

    fetched = await store.get_backtest_run("qbt_2")
    assert fetched is not None
    assert fetched.status == "invalid"
    assert fetched.metrics is None
    assert fetched.warnings == []


async def test_backtest_run_survives_reopening_the_store(tmp_path: Path) -> None:
    path = tmp_path / "work" / "quant-agent.sqlite3"
    first = SqliteQuantStore(path)
    await first.initialize()
    await first.create_backtest_run(_run())

    reopened = SqliteQuantStore(path)
    await reopened.initialize()
    fetched = await reopened.get_backtest_run("qbt_1")
    assert fetched is not None
    assert fetched.symbol == "EURUSD"
