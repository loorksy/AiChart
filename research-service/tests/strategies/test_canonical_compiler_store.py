from __future__ import annotations

import asyncio
import copy
import json
from collections.abc import Callable
from typing import Any

import pytest

from app.strategies.canonical import canonical_strategy_json
from app.strategies.compiler import compile_strategy
from app.strategies.errors import StrategyCompileError, StrategyStoreConflictError
from app.strategies.hashing import strategy_spec_hash
from app.strategies.models import StrategyVersionStatus
from app.strategies.store import InMemoryStrategyStore
from app.strategies.validation import parse_strategy_specification


def _reversed_objects(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _reversed_objects(item) for key, item in reversed(tuple(value.items()))}
    if isinstance(value, list):
        return [_reversed_objects(item) for item in value]
    return value


def test_canonical_hash_ignores_json_object_key_order(
    valid_strategy_payload: dict[str, Any],
) -> None:
    first = parse_strategy_specification(valid_strategy_payload)
    second_payload = json.loads(json.dumps(_reversed_objects(valid_strategy_payload)))
    second = parse_strategy_specification(second_payload)
    assert canonical_strategy_json(first) == canonical_strategy_json(second)
    assert strategy_spec_hash(first) == strategy_spec_hash(second)
    assert len(strategy_spec_hash(first)) == 64


def test_canonicalization_normalizes_set_like_fields(
    payload_copy: Callable[[], dict[str, Any]],
) -> None:
    first_payload = payload_copy()
    second_payload = payload_copy()
    second_payload["symbols"].reverse()
    second_payload["timeframes"]["higher"].reverse()
    second_payload["entry_conditions"]["all"][2]["sessions"].reverse()
    first = parse_strategy_specification(first_payload)
    second = parse_strategy_specification(second_payload)
    assert strategy_spec_hash(first) == strategy_spec_hash(second)


def test_compiler_returns_metadata_not_source(valid_strategy_payload: dict[str, Any]) -> None:
    compiled = compile_strategy(valid_strategy_payload)
    assert compiled.source_generated is False
    assert compiled.signal_timing == "bar_close"
    assert compiled.order_activation_timing == "next_bar"
    assert compiled.condition_types == ("ema_relation", "market_session", "rsi_threshold")
    assert {(item.indicator, item.period) for item in compiled.indicator_requirements} == {
        ("ema", 20),
        ("ema", 50),
        ("rsi", 14),
    }
    assert compiled.warmup_bars["1h"] == 50
    assert [item.symbol for item in compiled.symbol_metadata] == ["EURUSD", "XAUUSD"]


def test_compiler_collects_atr_and_range_warmup(
    payload_copy: Callable[[], dict[str, Any]],
) -> None:
    payload = payload_copy()
    payload["entry_conditions"] = {
        "all": [
            {
                "type": "atr_threshold",
                "timeframe": "15m",
                "period": 21,
                "operator": "above",
                "value": 1.0,
                "unit": "price",
            },
            {
                "type": "range_breakout",
                "timeframe": "1h",
                "lookback_bars": 80,
                "direction": "above_high",
            },
        ]
    }
    payload["stop_loss"] = {
        "type": "atr_multiple",
        "value": 2.0,
        "period": 14,
        "timeframe": "15m",
    }
    compiled = compile_strategy(payload)
    assert compiled.warmup_bars == {"15m": 21, "1h": 80, "4h": 1}


def test_compiler_rejects_invalid_input(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload.pop("stop_loss")
    with pytest.raises(StrategyCompileError):
        compile_strategy(payload)


def test_in_memory_store_creates_immutable_version(
    valid_strategy_payload: dict[str, Any],
) -> None:
    async def scenario() -> None:
        store = InMemoryStrategyStore()
        version = await store.create_version(
            valid_strategy_payload,
            version_number=1,
            created_by_user_id=7,
            status=StrategyVersionStatus.VALID,
            change_summary="initial",
        )
        definition = await store.get_definition("strat.fx.ema")
        fetched = await store.get_version("strat.fx.ema", "ver.fx.ema.1")
        assert definition is not None and definition.latest_version_id == "ver.fx.ema.1"
        assert fetched == version
        assert fetched is not version
        assert (await store.list_versions("strat.fx.ema")) == (version,)

    asyncio.run(scenario())


def test_store_rejects_overwrite(valid_strategy_payload: dict[str, Any]) -> None:
    async def scenario() -> None:
        store = InMemoryStrategyStore()
        await store.create_version(valid_strategy_payload, version_number=1, created_by_user_id=7)
        with pytest.raises(StrategyStoreConflictError, match="immutable"):
            await store.create_version(
                valid_strategy_payload, version_number=1, created_by_user_id=7
            )

    asyncio.run(scenario())


def test_store_enforces_parent_and_sequence(
    payload_copy: Callable[[], dict[str, Any]],
) -> None:
    async def scenario() -> None:
        store = InMemoryStrategyStore()
        first = payload_copy()
        await store.create_version(first, version_number=1, created_by_user_id=7)
        second = copy.deepcopy(first)
        second["version_id"] = "ver.fx.ema.2"
        second["name"] = "EMA continuation v2"
        with pytest.raises(StrategyStoreConflictError, match="parent"):
            await store.create_version(second, version_number=2, created_by_user_id=7)
        version = await store.create_version(
            second,
            version_number=2,
            parent_version_id="ver.fx.ema.1",
            created_by_user_id=7,
        )
        assert version.version_number == 2
        versions = await store.list_versions("strat.fx.ema")
        assert [item.version_number for item in versions] == [1, 2]

    asyncio.run(scenario())


def test_store_is_process_local_and_volatile(
    valid_strategy_payload: dict[str, Any],
) -> None:
    async def scenario() -> None:
        first_store = InMemoryStrategyStore()
        await first_store.create_version(
            valid_strategy_payload, version_number=1, created_by_user_id=7
        )
        restarted_store = InMemoryStrategyStore()
        assert await restarted_store.get_definition("strat.fx.ema") is None

    asyncio.run(scenario())
