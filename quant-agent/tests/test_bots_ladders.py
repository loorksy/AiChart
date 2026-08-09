"""Level ladders for the four bot types.

The layered-martingale case is the one to read: its volume multiplier RESTARTS
at every layer while its prices compound ACROSS layers. Upstream gets asked
about that line often enough that it is worth an explicit test both ways.
"""

from __future__ import annotations

import math

import pytest

from app.engine.bots.ladders import (
    BLOCKING_PREVIEW_WARNINGS,
    MAX_GRID_CELLS,
    basket_take_profit_price,
    grid_bot_params_from_executor_config,
    martingale_hard_stop_diagnostics,
    normalize_executor_payload,
    preview_executor,
    ratio,
    ratio_list,
)


def test_ratio_does_not_clamp_negatives_but_config_pct_does() -> None:
    from app.engine.bots.config import pct

    assert ratio(30) == 0.3
    assert ratio(0.3) == 0.3
    assert ratio(-30) == -0.3  # NOT clamped here
    assert pct(-30) == 0.0  # clamped there


def test_ratio_list_pads_by_repeating_and_truncates() -> None:
    # 1 stays 1.0 (the `> 1` heuristic, not `>= 1`); 2 becomes 0.02.
    assert ratio_list([1, 2], [0.5], expected=4) == [1.0, 0.02, 0.02, 0.02]
    assert ratio_list("2,3,4", [0.5], expected=2) == [0.02, 0.03]
    assert ratio_list(None, [0.005, 0.008], expected=3) == [0.005, 0.008, 0.008]
    assert ratio_list([], [0.01], expected=0) == [0.01]


def test_unsupported_executor_type_names_itself() -> None:
    with pytest.raises(ValueError, match="unsupported_executor_type:trend"):
        normalize_executor_payload({"executor_type": "trend"})


def test_neutral_grid_cannot_be_spot() -> None:
    with pytest.raises(ValueError, match="NEUTRAL_GRID_REQUIRES_SWAP"):
        normalize_executor_payload(
            {"executor_type": "grid", "side": "neutral", "market_type": "spot"}
        )


def test_dca_is_forced_spot_long_and_hourly() -> None:
    cfg = normalize_executor_payload({"executor_type": "dca", "side": "short", "leverage": 10})
    assert cfg["market_type"] == "spot"
    assert cfg["side"] == "long"
    assert cfg["timeframe"] == "1H"
    assert cfg["leverage"] == 1


def test_execution_mode_can_only_be_signal() -> None:
    """This service has no live path; a caller asking for one gets simulation."""
    assert normalize_executor_payload({"execution_mode": "live"})["execution_mode"] == "signal"
    assert normalize_executor_payload({})["execution_mode"] == "signal"


def test_grid_count_above_the_safe_limit_raises() -> None:
    with pytest.raises(ValueError, match="GRID_COUNT_EXCEEDS_SAFE_LIMIT"):
        preview_executor(
            {
                "executor_type": "grid",
                "start_price": 100,
                "end_price": 200,
                "grid_count": MAX_GRID_CELLS + 1,
            }
        )


def test_grid_preview_splits_the_budget_across_cells() -> None:
    preview = preview_executor(
        {
            "executor_type": "grid",
            "side": "long",
            "start_price": 100,
            "end_price": 200,
            "grid_count": 4,
            "total_amount_quote": 400,
        }
    )
    assert preview.executor_type == "grid"
    assert len(preview.levels) == 4
    assert all(level.amount_quote == 100 for level in preview.levels)
    # `grid_count` in this vocabulary counts CELLS.
    assert preview.config["grid_count"] == 4
    # Long ladder is emitted nearest-first, i.e. descending in price.
    prices = [level.price for level in preview.levels]
    assert prices == sorted(prices, reverse=True)


def test_neutral_grid_rounds_an_odd_cell_count_up_and_zeroes_initial_position() -> None:
    preview = preview_executor(
        {
            "executor_type": "grid",
            "side": "neutral",
            "market_type": "swap",
            "start_price": 100,
            "end_price": 200,
            "grid_count": 5,
            "total_amount_quote": 600,
            "initial_position_pct": 40,
        }
    )
    assert "neutral_grid_count_adjusted_even" in preview.warnings
    assert preview.config["grid_count"] == 6
    assert preview.config["initial_position_pct"] == 0.0
    assert len([lv for lv in preview.levels if lv.side == "long"]) == 3
    assert len([lv for lv in preview.levels if lv.side == "short"]) == 3


def test_grid_max_open_orders_is_capped_at_the_cell_count() -> None:
    preview = preview_executor(
        {
            "executor_type": "grid",
            "start_price": 100,
            "end_price": 200,
            "grid_count": 3,
            "max_open_orders": 50,
        }
    )
    assert preview.config["max_open_orders"] == 3
    assert "max_open_orders_adjusted_to_grid_count" in preview.warnings


def test_dca_ladder_schedules_by_interval_and_splits_the_budget() -> None:
    preview = preview_executor(
        {
            "executor_type": "dca",
            "entry_price": 50,
            "dca_max_orders": 4,
            "dca_total_budget_pct": 80,
            "dca_interval_minutes": 60,
        }
    )
    assert len(preview.levels) == 4
    assert preview.config["dca_total_budget_pct"] == 0.8
    assert preview.config["dca_order_pct"] == pytest.approx(0.2)
    assert [lv.scheduled_offset_minutes for lv in preview.levels] == [0, 60, 120, 180]
    assert [lv.action for lv in preview.levels] == ["open", "add", "add", "add"]
    assert preview.levels[-1].cumulative_amount_quote == pytest.approx(0.8)


def test_dca_with_no_budget_is_blocking() -> None:
    preview = preview_executor(
        {"executor_type": "dca", "entry_price": 50, "dca_total_budget_pct": 0}
    )
    assert "missing_dca_budget" in preview.warnings
    assert preview.blocking_warning == "missing_dca_budget"
    assert preview.blocking_warning in BLOCKING_PREVIEW_WARNINGS


def test_martingale_deviation_is_cumulative_and_geometric_in_step_multiplier() -> None:
    entry, deviation, step, volume, safety, base = 100.0, 0.01, 2.0, 1.5, 8.0, 10.0
    preview = preview_executor(
        {
            "executor_type": "martingale",
            "side": "long",
            "entry_price": entry,
            "base_order_size": base,
            "safety_order_size": safety,
            "max_layers": 4,
            "price_deviation_pct": deviation,
            "step_multiplier": step,
            "volume_multiplier": volume,
            "trailing_take_profit_enabled": False,
        }
    )
    prices = [level.price for level in preview.levels]
    amounts = [level.amount_quote for level in preview.levels]

    cumulative = 0.0
    expected_prices = [entry]
    for layer in range(2, 5):
        cumulative += deviation * (step ** (layer - 2))
        expected_prices.append(entry * (1.0 - cumulative))
    for actual, expected in zip(prices, expected_prices, strict=True):
        assert actual == pytest.approx(expected)

    assert amounts[0] == base
    for layer in range(2, 5):
        assert amounts[layer - 1] == pytest.approx(safety * (volume ** (layer - 2)))


def test_layered_martingale_volume_restarts_per_layer_while_price_compounds() -> None:
    base, volume = 10.0, 2.0
    entry = 100.0
    intra = [0.01, 0.01]
    inter = [0.10, 0.10]
    preview = preview_executor(
        {
            "executor_type": "layered_martingale",
            "side": "long",
            "entry_price": entry,
            "layer_count": 3,
            "orders_per_layer": 3,
            "base_order_size": base,
            "volume_multiplier": volume,
            "intra_spacings": intra,
            "inter_spacings": inter,
            "trailing_take_profit_enabled": False,
        }
    )
    assert len(preview.levels) == 9

    # SIZE depends on order_index only -> the multiplier restarts every layer.
    sizes_by_layer = [
        [lv.amount_quote for lv in preview.levels if lv.layer_index == layer]
        for layer in (1, 2, 3)
    ]
    expected_sizes = [base, base * volume, base * volume**2]
    for layer_sizes in sizes_by_layer:
        for actual, expected in zip(layer_sizes, expected_sizes, strict=True):
            assert actual == pytest.approx(expected)
    # Layer 3's first order is exactly layer 1's first order.
    assert sizes_by_layer[2][0] == pytest.approx(sizes_by_layer[0][0])

    # PRICE compounds continuously ACROSS layers.
    expected_price = entry
    for index, level in enumerate(preview.levels):
        if index == 0:
            pass
        elif level.order_index == 1:
            expected_price *= 1.0 - inter[level.layer_index - 2]
        else:
            expected_price *= 1.0 - intra[level.order_index - 2]
        assert level.price == pytest.approx(expected_price)
    # ... so the last price is strictly below the first of any earlier layer.
    assert preview.levels[-1].price < preview.levels[0].price


def test_layered_martingale_short_side_mirrors_upwards() -> None:
    preview = preview_executor(
        {
            "executor_type": "layered_martingale",
            "side": "short",
            "market_type": "swap",
            "entry_price": 100,
            "layer_count": 2,
            "orders_per_layer": 2,
            "base_order_size": 10,
            "trailing_take_profit_enabled": False,
        }
    )
    prices = [level.price for level in preview.levels]
    assert prices == sorted(prices)
    assert prices[0] == 100


def test_basket_take_profit_uses_the_running_average() -> None:
    tp = basket_take_profit_price(
        total_quote=200.0, total_quantity=2.0, side="long", take_profit=0.05
    )
    assert tp == pytest.approx(105.0)
    short = basket_take_profit_price(
        total_quote=200.0, total_quantity=2.0, side="short", take_profit=0.05
    )
    assert short == pytest.approx(95.0)
    assert basket_take_profit_price(
        total_quote=0.0, total_quantity=2.0, side="long", take_profit=0.05
    ) == 0.0


def test_hard_stop_that_blocks_a_level_is_diagnosed_not_silently_accepted() -> None:
    preview = preview_executor(
        {
            "executor_type": "martingale",
            "side": "long",
            "entry_price": 100,
            "base_order_size": 10,
            "safety_order_size": 10,
            "max_layers": 3,
            "price_deviation_pct": 0.10,
            "hard_stop_pct": 0.02,
            "trailing_take_profit_enabled": False,
        }
    )
    assert "hard_stop_blocks_level" in preview.warnings
    codes = {item["code"] for item in preview.risk_diagnostics}
    assert codes == {"hard_stop_blocks_level"}
    first = preview.risk_diagnostics[0]
    assert first["before_level"] == 2
    assert first["suggested_stop_pct"] == pytest.approx(
        min(1.0, float(first["required_stop_pct"]) + 0.005)
    )


def test_no_diagnostics_when_no_hard_stop_is_configured() -> None:
    assert martingale_hard_stop_diagnostics([], hard_stop_pct=0.0, side="long") == []


def test_invalid_trailing_take_profit_is_blocking() -> None:
    preview = preview_executor(
        {
            "executor_type": "martingale",
            "entry_price": 100,
            "base_order_size": 10,
            "trailing_take_profit_enabled": True,
            "trailing_activation_pct": 0.002,
            "trailing_callback_pct": 0.005,
        }
    )
    assert "invalid_trailing_take_profit" in preview.warnings
    assert preview.blocking_warning in BLOCKING_PREVIEW_WARNINGS


def test_executor_config_bridges_to_bot_params_as_cells() -> None:
    """The vocabulary bridge. `gridCountUnit: "cells"` is the whole point."""
    preview = preview_executor(
        {
            "executor_type": "grid",
            "side": "long",
            "start_price": 100,
            "end_price": 200,
            "grid_count": 8,
            "total_amount_quote": 800,
            "initial_position_pct": 20,
        }
    )
    params = grid_bot_params_from_executor_config(preview.config, trade_direction="long")
    assert params["gridCountUnit"] == "cells"
    assert params["gridCount"] == 8
    assert params["lowerPrice"] == 100
    assert params["upperPrice"] == 200
    assert params["amountPerGrid"] == pytest.approx(100.0)
    assert params["amountPerGridPct"] == pytest.approx(0.125)
    assert params["initialPositionPct"] == pytest.approx(0.2)

    from app.engine.bots.config import GridBotConfig

    cfg = GridBotConfig.from_trading_config({"bot_params": params})
    assert cfg.grid_line_count == 9
    assert cfg.tradable_cell_count == 8


def test_neutral_bridge_zeroes_the_initial_position() -> None:
    params = grid_bot_params_from_executor_config(
        {"start_price": 100, "end_price": 200, "grid_count": 4, "initial_position_pct": 0.5},
        trade_direction="neutral",
    )
    assert params["initialPositionPct"] == 0.0


def test_preview_summary_totals_are_finite_and_sum_the_levels() -> None:
    preview = preview_executor(
        {
            "executor_type": "grid",
            "start_price": 100,
            "end_price": 200,
            "grid_count": 4,
            "total_amount_quote": 400,
        }
    )
    summary = preview.to_dict()["summary"]
    assert summary["level_count"] == 4
    assert summary["total_amount_quote"] == pytest.approx(400.0)
    assert math.isfinite(float(summary["first_price"]))
