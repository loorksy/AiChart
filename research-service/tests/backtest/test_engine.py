from __future__ import annotations

import asyncio
import copy
from datetime import timedelta

import pytest

from app.backtest import BacktestEngine, RunConfig
from app.backtest.models import IntrabarPolicy, Side
from app.data import validate_dataset
from app.jobs.cancellation import JobCancelled


async def test_signal_on_n_fills_n_plus_one_and_partial_targets(
    simple_strategy, rising_dataset
) -> None:
    engine = BacktestEngine(
        simple_strategy,
        rising_dataset,
        RunConfig(initial_capital=10_000.0, account_currency="USD"),
    )
    result = await engine.run()
    assert len(result.trades) == 1
    trade = result.trades[0]
    bars = rising_dataset.bars
    assert trade.entry_time == bars[1].timestamp
    assert trade.net_pnl > 0
    partials = [event for event in result.events if event["type"] == "partial_exit"]
    assert len(partials) == 1
    assert result.metrics["trade_count"] == 1
    assert result.metrics["spread_cost_total"] == 0
    assert result.final_balance > 10_000


async def test_engine_is_reproducible(simple_strategy, rising_dataset) -> None:
    config = RunConfig(initial_capital=10_000.0, account_currency="USD", seed=77)
    first = await BacktestEngine(simple_strategy, rising_dataset, config).run()
    second = await BacktestEngine(simple_strategy, rising_dataset, config).run()
    assert first.metrics == second.metrics
    assert [trade.net_pnl for trade in first.trades] == [trade.net_pnl for trade in second.trades]


async def test_cancellation_is_checked_during_simulation(simple_strategy, rising_dataset) -> None:
    cancelled = asyncio.Event()
    cancelled.set()
    with pytest.raises(JobCancelled):
        await BacktestEngine(
            simple_strategy,
            rising_dataset,
            RunConfig(initial_capital=10_000.0),
        ).run(cancelled)


def test_cross_currency_accounting_requires_conversion(
    simple_strategy_payload, rising_dataset
) -> None:
    simple_strategy_payload["symbols"] = ["USDJPY"]
    simple_strategy_payload["position_sizing"] = {
        "type": "fixed_lot",
        "lots": 0.1,
    }
    from app.strategies import parse_strategy_specification

    strategy = parse_strategy_specification(simple_strategy_payload)
    with pytest.raises(ValueError, match="conversion data"):
        BacktestEngine(strategy, rising_dataset, RunConfig(initial_capital=10_000.0))


def test_indicator_value_entry_reuses_the_point_in_time_indicator_series(
    simple_strategy_payload, rising_dataset
) -> None:
    payload = copy.deepcopy(simple_strategy_payload)
    payload["entry"] = {
        "order_type": "limit",
        "price_reference": "indicator_value",
        "offset_type": "none",
        "offset_value": 0.0,
        "indicator": {"indicator": "ema", "timeframe": "15m", "period": 2},
        "valid_for_bars": 1,
        "cancel_on_opposite_signal": True,
        "allow_reentry": False,
        "cooldown_bars": 0,
    }
    from app.strategies import parse_strategy_specification

    engine = BacktestEngine(
        parse_strategy_specification(payload),
        rising_dataset,
        RunConfig(initial_capital=10_000.0),
    )
    bars = list(rising_dataset.bars)
    reference = engine._reference_entry(Side.LONG, bars[1], {"15m": bars}, 1)
    assert reference == pytest.approx((1.0 + 1.0005) / 2)


@pytest.mark.parametrize("policy", list(IntrabarPolicy))
async def test_same_bar_pending_entry_records_ambiguity_and_selected_policy(
    policy: IntrabarPolicy,
    simple_strategy_payload,
    rising_dataset,
) -> None:
    payload = copy.deepcopy(simple_strategy_payload)
    payload["entry"] = {
        "order_type": "stop",
        "price_reference": "fixed_offset_from_signal_close",
        "offset_type": "pips",
        "offset_value": 5.0,
        "valid_for_bars": 1,
        "cancel_on_opposite_signal": True,
        "allow_reentry": False,
        "cooldown_bars": 0,
    }
    payload["stop_loss"] = {"type": "fixed_pips", "value": 10.0}
    bars = list(rising_dataset.bars)
    bars[1] = bars[1].model_copy(
        update={
            "open": bars[0].close,
            "high": type(bars[1].high)("1.0040"),
            "low": type(bars[1].low)("0.9980"),
            "close": type(bars[1].close)("1.0010"),
        }
    )
    dataset = validate_dataset(tuple(bars)).dataset
    from app.strategies import parse_strategy_specification

    result = await BacktestEngine(
        parse_strategy_specification(payload),
        dataset,
        RunConfig(initial_capital=10_000.0, intrabar_policy=policy),
    ).run()
    assert len(result.trades) == 1
    assert result.trades[0].intrabar_ambiguous is True
    assert result.trades[0].intrabar_policy == policy.value
    ambiguity_events = [
        event for event in result.events if str(event["type"]).startswith("intrabar_ambiguous")
    ]
    assert ambiguity_events
    assert ambiguity_events[0]["policy"] == policy.value


async def test_closed_weekend_bar_is_rejected_explicitly(simple_strategy, rising_dataset) -> None:
    bars = [
        bar.model_copy(update={"timestamp": bar.timestamp + timedelta(days=5)})
        for bar in rising_dataset.bars
    ]
    weekend_dataset = validate_dataset(tuple(bars)).dataset
    with pytest.raises(ValueError, match="closed Forex weekend"):
        await BacktestEngine(
            simple_strategy,
            weekend_dataset,
            RunConfig(initial_capital=10_000.0),
        ).run()


async def test_order_is_rejected_when_free_margin_cannot_cover_entry(
    simple_strategy_payload,
    rising_dataset,
) -> None:
    payload = copy.deepcopy(simple_strategy_payload)
    payload["position_sizing"] = {"type": "fixed_lot", "lots": 10.0}
    from app.strategies import parse_strategy_specification

    result = await BacktestEngine(
        parse_strategy_specification(payload),
        rising_dataset,
        RunConfig(initial_capital=100.0, leverage=1.0),
    ).run()
    assert result.trades == []
    assert any(event.get("reason") == "insufficient_margin" for event in result.events)
