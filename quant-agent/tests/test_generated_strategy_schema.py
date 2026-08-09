from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from app.engine.strategies.generated.schema import GeneratedStrategySpec


def _valid_spec(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "strategy_id": "declarative_ema_cross_v1",
        "version": "1.0.0",
        "display_name": "Declarative EMA Cross",
        "description": "EMA20/50 crossover gated by ADX",
        "regime_affinity": "trend",
        "direction": "buy",
        "entry_conditions": {
            "all": [
                {
                    "type": "ema_relation",
                    "fast_period": 20,
                    "slow_period": 50,
                    "operator": "crosses_above",
                },
                {"type": "adx_threshold", "operator": "above", "value": 20.0},
            ]
        },
        "stop_loss_atr_multiple": 1.5,
        "take_profit_r_multiples": [1.0, 2.0, 3.0],
    }
    base.update(overrides)
    return base


def test_valid_spec_is_accepted() -> None:
    spec = GeneratedStrategySpec.model_validate(_valid_spec(), strict=True)
    assert spec.strategy_id == "declarative_ema_cross_v1"
    assert spec.direction == "buy"
    assert spec.take_profit_r_multiples == [1.0, 2.0, 3.0]


def test_valid_spec_with_all_leaf_types_and_combinators_is_accepted() -> None:
    spec = _valid_spec(
        entry_conditions={
            "any": [
                {
                    "type": "ema_relation",
                    "fast_period": 20,
                    "slow_period": 200,
                    "operator": "above",
                },
                {"type": "rsi_threshold", "operator": "below", "value": 30.0},
                {
                    "type": "macd",
                    "series": "line",
                    "reference": "signal",
                    "operator": "crosses_above",
                },
                {
                    "type": "macd",
                    "series": "histogram",
                    "reference": "zero",
                    "operator": "above",
                },
                {
                    "type": "macd",
                    "series": "line",
                    "reference": "value",
                    "operator": "above",
                    "value": 0.001,
                },
                {"type": "bollinger_touch", "band": "lower", "operator": "below"},
                {"type": "adx_threshold", "operator": "above", "value": 20.0},
                {"type": "regime", "regime": "range"},
                {"not": {"type": "regime", "regime": "high_volatility"}},
            ]
        }
    )
    validated = GeneratedStrategySpec.model_validate(spec, strict=True)
    assert validated.entry_conditions.any is not None
    assert len(validated.entry_conditions.any) == 9


def test_unknown_condition_type_is_rejected() -> None:
    spec = _valid_spec(entry_conditions={"all": [{"type": "made_up", "value": 1}]})
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_depth_over_limit_is_rejected() -> None:
    leaf = {"type": "adx_threshold", "operator": "above", "value": 1.0}
    tree: dict[str, Any] = leaf
    for _ in range(9):  # depth 9 > MAX_TREE_DEPTH (8)
        tree = {"all": [tree]}
    spec = _valid_spec(entry_conditions=tree)
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_leaf_count_over_limit_is_rejected() -> None:
    leaf = {"type": "adx_threshold", "operator": "above", "value": 1.0}
    spec = _valid_spec(entry_conditions={"all": [dict(leaf) for _ in range(33)]})
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_rsi_threshold_out_of_range_is_rejected() -> None:
    spec = _valid_spec(
        entry_conditions={"all": [{"type": "rsi_threshold", "operator": "above", "value": 150.0}]}
    )
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_negative_stop_loss_atr_multiple_is_rejected() -> None:
    spec = _valid_spec(stop_loss_atr_multiple=-1.0)
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_non_ascending_take_profit_r_multiples_is_rejected() -> None:
    spec = _valid_spec(take_profit_r_multiples=[2.0, 1.0, 3.0])
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_numeric_value_as_string_is_rejected_under_strict_mode() -> None:
    spec = _valid_spec(stop_loss_atr_multiple="1.5")
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_rsi_value_as_string_is_rejected_under_strict_mode() -> None:
    spec = _valid_spec(
        entry_conditions={"all": [{"type": "rsi_threshold", "operator": "above", "value": "30"}]}
    )
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_ema_relation_requires_fast_smaller_than_slow() -> None:
    spec = _valid_spec(
        entry_conditions={
            "all": [
                {
                    "type": "ema_relation",
                    "fast_period": 50,
                    "slow_period": 20,
                    "operator": "above",
                }
            ]
        }
    )
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_ema_relation_period_outside_enum_is_rejected() -> None:
    spec = _valid_spec(
        entry_conditions={
            "all": [
                {"type": "ema_relation", "fast_period": 10, "slow_period": 50, "operator": "above"}
            ]
        }
    )
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_condition_tree_requires_exactly_one_combinator() -> None:
    spec = _valid_spec(
        entry_conditions={
            "all": [{"type": "adx_threshold", "operator": "above", "value": 20.0}],
            "any": [{"type": "adx_threshold", "operator": "above", "value": 20.0}],
        }
    )
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_extra_field_is_rejected() -> None:
    spec = _valid_spec()
    spec["unexpected_field"] = "nope"
    with pytest.raises(ValidationError):
        GeneratedStrategySpec.model_validate(spec, strict=True)


def test_spec_round_trips_through_json() -> None:
    spec = GeneratedStrategySpec.model_validate(_valid_spec(), strict=True)
    dumped = spec.model_dump_json()
    round_tripped = GeneratedStrategySpec.model_validate_json(dumped, strict=True)
    assert round_tripped == spec


def test_not_combinator_round_trips_through_json() -> None:
    spec = GeneratedStrategySpec.model_validate(
        _valid_spec(
            entry_conditions={"not": {"type": "regime", "regime": "high_volatility"}}
        ),
        strict=True,
    )
    dumped = spec.model_dump_json()
    round_tripped = GeneratedStrategySpec.model_validate_json(dumped, strict=True)
    assert round_tripped.entry_conditions.not_condition is not None
