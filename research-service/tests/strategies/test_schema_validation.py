from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from app.strategies.errors import StrategyValidationError
from app.strategies.models import Direction
from app.strategies.validation import (
    parse_strategy_specification,
    validate_strategy_specification,
)


def test_valid_long_strategy_normalizes_symbols(
    valid_strategy_payload: dict[str, Any],
) -> None:
    spec = parse_strategy_specification(valid_strategy_payload)
    assert spec.direction is Direction.LONG
    assert spec.symbols == ("EURUSD", "XAUUSD")
    assert len(spec.targets) == 2


def test_valid_short_strategy(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload["direction"] = "short"
    spec = parse_strategy_specification(payload)
    assert spec.direction is Direction.SHORT


def test_valid_both_requires_separate_trees(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    tree = payload.pop("entry_conditions")
    payload["direction"] = "both"
    payload["long_entry_conditions"] = tree
    payload["short_entry_conditions"] = {
        "all": [
            {
                "type": "sma_relation",
                "timeframe": "1h",
                "fast_period": 20,
                "slow_period": 50,
                "operator": "below",
            }
        ]
    }
    spec = parse_strategy_specification(payload)
    assert spec.direction is Direction.BOTH
    assert len(spec.condition_trees()) == 2


@pytest.mark.parametrize("direction", ["long", "short"])
def test_single_direction_requires_conditions(
    payload_copy: Callable[[], dict[str, Any]], direction: str
) -> None:
    payload = payload_copy()
    payload["direction"] = direction
    payload.pop("entry_conditions")
    with pytest.raises(StrategyValidationError, match="requires entry_conditions"):
        parse_strategy_specification(payload)


def test_both_rejects_shared_tree(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload["direction"] = "both"
    with pytest.raises(StrategyValidationError, match="separate long and short"):
        parse_strategy_specification(payload)


def test_stop_loss_is_mandatory(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload.pop("stop_loss")
    with pytest.raises(StrategyValidationError, match="stop_loss"):
        parse_strategy_specification(payload)


def test_unknown_timeframe_rejected(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload["timeframes"]["entry"] = "2h"
    with pytest.raises(StrategyValidationError, match="timeframes.entry"):
        parse_strategy_specification(payload)


def test_condition_timeframe_must_be_declared(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload["entry_conditions"]["all"][0]["timeframe"] = "30m"
    with pytest.raises(StrategyValidationError, match="condition timeframe"):
        parse_strategy_specification(payload)


def test_higher_timeframes_must_actually_be_higher(
    payload_copy: Callable[[], dict[str, Any]],
) -> None:
    payload = payload_copy()
    payload["timeframes"]["higher"] = ["5m", "1h"]
    with pytest.raises(StrategyValidationError, match="greater than"):
        parse_strategy_specification(payload)


def test_unknown_condition_rejected(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload["entry_conditions"]["all"][0] = {
        "type": "python_expression",
        "code": "future_close > close",
    }
    with pytest.raises(StrategyValidationError, match="Input tag"):
        parse_strategy_specification(payload)


def test_unknown_keys_rejected(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload["entry_conditions"]["all"][0]["expression"] = "close[-1]"
    with pytest.raises(StrategyValidationError, match="Extra inputs"):
        parse_strategy_specification(payload)


@pytest.mark.parametrize("period", [-1, 0, 20])
def test_invalid_moving_average_periods(
    payload_copy: Callable[[], dict[str, Any]], period: int
) -> None:
    payload = payload_copy()
    payload["entry_conditions"]["all"][0]["fast_period"] = period
    if period == 20:
        payload["entry_conditions"]["all"][0]["slow_period"] = 20
    with pytest.raises(StrategyValidationError):
        parse_strategy_specification(payload)


def test_non_finite_value_rejected(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload["targets"][0]["value"] = float("nan")
    with pytest.raises(StrategyValidationError):
        parse_strategy_specification(payload)


@pytest.mark.parametrize("sizes", [[40.0, 50.0], [60.0, 50.0], [0.0, 100.0]])
def test_target_percentages_rejected(
    payload_copy: Callable[[], dict[str, Any]], sizes: list[float]
) -> None:
    payload = payload_copy()
    for target, size in zip(payload["targets"], sizes, strict=True):
        target["size_percent"] = size
    with pytest.raises(StrategyValidationError):
        parse_strategy_specification(payload)


def test_duplicate_normalized_symbols_rejected(
    payload_copy: Callable[[], dict[str, Any]],
) -> None:
    payload = payload_copy()
    payload["symbols"] = ["EURUSD", "eur/usd"]
    with pytest.raises(StrategyValidationError, match="duplicate normalized"):
        parse_strategy_specification(payload)


def test_unknown_symbol_metadata_rejected(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload["symbols"] = ["BTCUSD"]
    with pytest.raises(StrategyValidationError, match="unsupported symbol metadata"):
        parse_strategy_specification(payload)


def test_cross_currency_risk_sizing_rejected(
    payload_copy: Callable[[], dict[str, Any]],
) -> None:
    payload = payload_copy()
    payload["symbols"] = ["USDJPY"]
    with pytest.raises(StrategyValidationError, match="direct quote-currency"):
        parse_strategy_specification(payload)


def test_fixed_lot_allows_registered_cross_currency(
    payload_copy: Callable[[], dict[str, Any]],
) -> None:
    payload = payload_copy()
    payload["symbols"] = ["USDJPY"]
    payload["position_sizing"] = {"type": "fixed_lot", "lots": 0.1}
    assert parse_strategy_specification(payload).symbols == ("USDJPY",)


def test_market_entry_cannot_fill_at_signal_close(
    payload_copy: Callable[[], dict[str, Any]],
) -> None:
    payload = payload_copy()
    payload["entry"]["price_reference"] = "signal_bar_close"
    with pytest.raises(StrategyValidationError, match="next_bar_open"):
        parse_strategy_specification(payload)


def test_seeded_slippage_requires_explicit_seed(
    payload_copy: Callable[[], dict[str, Any]],
) -> None:
    payload = payload_copy()
    payload["costs"]["slippage"] = {
        "type": "seeded_distribution",
        "distribution": "normal",
        "mean": 0.0,
        "standard_deviation": 0.2,
        "maximum_absolute_pips": 1.0,
    }
    with pytest.raises(StrategyValidationError, match="seed"):
        parse_strategy_specification(payload)


def test_accurate_carry_cannot_silently_be_zero(
    payload_copy: Callable[[], dict[str, Any]],
) -> None:
    payload = payload_copy()
    payload["costs"]["swap_or_carry"] = {"type": "none", "require_accurate": True}
    with pytest.raises(StrategyValidationError):
        parse_strategy_specification(payload)


def test_validation_result_is_safe_and_typed(payload_copy: Callable[[], dict[str, Any]]) -> None:
    payload = payload_copy()
    payload["entry_conditions"]["all"][0]["fast_period"] = -1
    result = validate_strategy_specification(payload)
    assert result.valid is False
    assert result.canonical_spec is None
    assert result.spec_hash is None
    assert "-1" not in " ".join(result.errors)
