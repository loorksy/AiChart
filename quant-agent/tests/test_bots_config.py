"""`GridBotConfig` parsing — the aliases, the defaults and the two traps."""

from __future__ import annotations

from app.engine.bots.config import (
    GridBotConfig,
    pct,
    sanitize_grid_bot_params,
    to_float,
    to_int,
)


def test_percent_helper_treats_anything_above_one_as_a_percentage() -> None:
    assert pct(30) == 0.3
    assert pct(0.3) == 0.3
    # 1 is 100%, not 1%. Ambiguous by construction, and upstream resolves it
    # this way; the UI must send 0.01 for one percent.
    assert pct(1) == 1.0
    assert pct(0.5) == 0.5
    assert pct(-5) == 0.0
    assert pct(None, 0.25) == 0.25
    assert pct("bogus", 0.1) == 0.1


def test_scalar_coercions_fall_back_rather_than_raise() -> None:
    assert to_float("1.5") == 1.5
    assert to_float(None, 2.0) == 2.0
    assert to_float("x", 3.0) == 3.0
    assert to_int("7") == 7
    assert to_int(None, 4) == 4
    assert to_int("x", 5) == 5


def test_neutral_grids_have_their_initial_position_cleared() -> None:
    out = sanitize_grid_bot_params(
        {"gridDirection": "neutral", "initialPositionPct": 40, "initial_position_pct": 0.4}
    )
    assert out["initialPositionPct"] == 0
    assert "initial_position_pct" not in out
    # Directional grids keep theirs.
    kept = sanitize_grid_bot_params({"gridDirection": "long", "initialPositionPct": 40})
    assert kept["initialPositionPct"] == 40
    # Not a dict at all is an empty dict, never an exception.
    assert sanitize_grid_bot_params(None) == {}


def test_both_case_conventions_are_accepted() -> None:
    camel = GridBotConfig.from_trading_config(
        {
            "bot_params": {
                "upperPrice": 200,
                "lowerPrice": 100,
                "gridCount": 6,
                "amountPerGrid": 25,
                "gridMode": "geometric",
                "gridDirection": "short",
                "maxOpenOrders": 3,
                "orderFrequency": 5,
            }
        }
    )
    snake = GridBotConfig.from_trading_config(
        {
            "bot_params": {
                "upper_price": 200,
                "lower_price": 100,
                "grid_count": 6,
                "amount_per_grid": 25,
                "grid_mode": "geometric",
                "grid_direction": "short",
                "max_open_orders": 3,
                "order_frequency": 5,
            }
        }
    )
    assert camel == snake


def test_defaults_and_normalizations() -> None:
    cfg = GridBotConfig.from_trading_config({})
    assert cfg.grid_count == 10
    assert cfg.grid_mode == "arithmetic"
    assert cfg.grid_direction == "long"
    assert cfg.order_mode == "maker"
    assert cfg.boundary_action == "pause"
    assert cfg.market_type == "swap"
    assert cfg.margin_mode == "cross"
    assert cfg.grid_count_unit == "lines"
    assert cfg.max_open_orders == 999999
    assert cfg.leverage == 1.0


def test_unknown_enum_values_fall_back_rather_than_raise() -> None:
    cfg = GridBotConfig.from_trading_config(
        {
            "market_type": "perpetual",
            "bot_params": {
                "gridDirection": "sideways",
                "boundaryAction": "explode",
                "gridCountUnit": "furlongs",
            },
        }
    )
    assert cfg.grid_direction == "long"
    assert cfg.boundary_action == "pause"
    assert cfg.grid_count_unit == "lines"
    assert cfg.market_type == "swap"


def test_grid_count_is_floored_at_two_and_leverage_at_one() -> None:
    cfg = GridBotConfig.from_trading_config({"leverage": 0.1, "bot_params": {"gridCount": 1}})
    assert cfg.grid_count == 2
    assert cfg.leverage == 1.0


def test_effective_bounds_override_without_mutating_config() -> None:
    cfg = GridBotConfig.from_trading_config(
        {"bot_params": {"lowerPrice": 100, "upperPrice": 200}}
    )
    assert cfg.effective_bounds(None) == (200.0, 100.0)
    assert cfg.effective_bounds({"upperPrice": 250, "lowerPrice": 90}) == (250.0, 90.0)
    assert cfg.upper_price == 200.0
    assert cfg.lower_price == 100.0
