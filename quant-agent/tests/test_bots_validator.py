"""Grid config validation, including the two rejection sentences a user reads.

Both messages are asserted BYTE FOR BYTE, and the fee-coverage case also pins
WHICH cell gets named. Upstream tracks the minimum-margin cell, and because the
round-trip fee scales with `(lo + hi)` while an arithmetic grid's gross is
constant, the worst cell is the TOP one — not the first, which is the intuitive
wrong answer.
"""

from __future__ import annotations

from app.engine.bots.config import GridBotConfig
from app.engine.bots.validator import (
    MIN_GRID_FEE_COVERAGE_MULTIPLIER,
    validate_grid_config,
)


def cfg_from(**bot_params: object) -> GridBotConfig:
    return GridBotConfig.from_trading_config({"bot_params": bot_params})


def test_multiplier_is_upstreams_1_25() -> None:
    assert MIN_GRID_FEE_COVERAGE_MULTIPLIER == 1.25


def test_inverted_bounds_are_rejected_first() -> None:
    ok, message, warnings = validate_grid_config(
        cfg_from(lowerPrice=200.0, upperPrice=100.0, amountPerGrid=10.0)
    )
    assert ok is False
    assert message == "upperPrice must be greater than lowerPrice"
    assert warnings == []


def test_zero_amount_per_grid_is_rejected() -> None:
    ok, message, _ = validate_grid_config(
        cfg_from(lowerPrice=100.0, upperPrice=200.0, amountPerGrid=0.0)
    )
    assert ok is False
    assert message == "amountPerGrid must be > 0"


def test_amount_per_grid_pct_satisfies_the_amount_check() -> None:
    ok, message, _ = validate_grid_config(
        cfg_from(lowerPrice=100.0, upperPrice=200.0, amountPerGridPct=10),
        initial_capital=1000.0,
    )
    assert (ok, message) == (True, "")


def test_unsupported_direction_names_itself() -> None:
    cfg = cfg_from(lowerPrice=100.0, upperPrice=200.0, amountPerGrid=10.0)
    cfg.grid_direction = "sideways"
    ok, message, _ = validate_grid_config(cfg)
    assert ok is False
    assert message == "unsupported gridDirection: sideways"


def test_initial_position_pct_outside_zero_to_one_is_rejected() -> None:
    cfg = cfg_from(lowerPrice=100.0, upperPrice=200.0, amountPerGrid=10.0)
    cfg.initial_position_pct = 1.5
    ok, message, _ = validate_grid_config(cfg)
    assert ok is False
    assert message == "initialPositionPct must be between 0 and 100 (or 0–1)"


def test_fee_coverage_rejection_message_is_byte_for_byte() -> None:
    ok, message, _ = validate_grid_config(
        cfg_from(lowerPrice=100.0, upperPrice=100.5, gridCount=11, amountPerGrid=10.0),
        initial_capital=1000.0,
        fee_rate=0.001,
    )
    assert ok is False
    assert message == (
        "Grid spacing is too narrow after fees: "
        "worst cell [100.4500, 100.5000] captures ~0.050% "
        "but needs ~0.250% to cover round-trip fees "
        "(0.100% per side plus safety buffer). "
        "Widen the price range, reduce gridCount, or lower fee settings."
    )
    # The TOP cell, not the bottom one: round-trip fee scales with (lo + hi).
    assert "[100.4500, 100.5000]" in message
    assert "[100.0000, 100.0500]" not in message


def test_min_spread_rejection_message_is_byte_for_byte() -> None:
    ok, message, _ = validate_grid_config(
        cfg_from(
            lowerPrice=100.0,
            upperPrice=110.0,
            gridCount=11,
            amountPerGrid=10.0,
            minSpreadBetweenOrders=0.02,
        ),
        initial_capital=1000.0,
        fee_rate=0.001,
    )
    assert ok is False
    assert message == (
        "Grid spacing is below minSpreadBetweenOrders: "
        "cell [100.0000, 101.0000] is 1.000% but requires at least 2.000%."
    )


def test_zero_fee_rate_never_rejects_on_fees() -> None:
    ok, message, _ = validate_grid_config(
        cfg_from(lowerPrice=100.0, upperPrice=100.5, gridCount=11, amountPerGrid=10.0),
        fee_rate=0.0,
    )
    assert (ok, message) == (True, "")


def test_small_initial_position_is_a_warning_not_a_rejection() -> None:
    ok, message, warnings = validate_grid_config(
        cfg_from(
            lowerPrice=100.0,
            upperPrice=110.0,
            gridCount=11,
            amountPerGridPct=1,
            initialPositionPct=20,
        ),
        initial_capital=100.0,
        fee_rate=0.001,
    )
    assert (ok, message) == (True, "")
    assert warnings == ["Initial position (~20.00 USDT) is small vs amountPerGrid (100.00)"]
