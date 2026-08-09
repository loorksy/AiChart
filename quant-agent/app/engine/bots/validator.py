"""Grid config validation — the gate a grid must clear before it may run.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger), Copyright
Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/grid/validator.py` (the whole file).

Changed on port: `validate_for_executor` is not carried across — it read a live
strategy row's `trading_config` from Postgres, which does not exist here; the
API layer builds the `GridBotConfig` itself and calls `validate_grid_config`
directly. Nothing else changed: the order of checks, the 1.25 fee-coverage
multiplier, the `.4f`/`.3f` formatting and the two rejection sentences are
reproduced byte for byte, because they are what a user reads when their grid is
refused and `tests/test_bots_validator.py` pins them character for character.

The fee guard is a per-UNIT comparison on purpose: leverage and quantity cancel
out, so a cell either clears round-trip commission or it does not, regardless of
how much is riding on it.
"""

from __future__ import annotations

from app.engine.bots.config import GridBotConfig
from app.engine.bots.levels import generate_cells, generate_levels

MIN_GRID_FEE_COVERAGE_MULTIPLIER = 1.25

# What the live runner passes when the strategy declares no commission
# (`trading_config["commission"] / 100.0`, floored here rather than there).
DEFAULT_FEE_RATE = 0.001


def _fee_rate_pct(fee_rate: float) -> float:
    try:
        return max(0.0, float(fee_rate or 0.0)) * 100.0
    except (TypeError, ValueError):
        return 0.0


def validate_grid_config(
    cfg: GridBotConfig,
    *,
    initial_capital: float = 0.0,
    fee_rate: float = DEFAULT_FEE_RATE,
) -> tuple[bool, str, list[str]]:
    """(ok, rejection_message, warnings). A warning never blocks."""
    warnings: list[str] = []
    if cfg.upper_price <= cfg.lower_price:
        return False, "upperPrice must be greater than lowerPrice", warnings
    effective_amount_per_grid = float(cfg.amount_per_grid or 0.0)
    if cfg.amount_per_grid_pct > 0 and initial_capital > 0:
        effective_amount_per_grid = initial_capital * cfg.amount_per_grid_pct
    if effective_amount_per_grid <= 0:
        return False, "amountPerGrid must be > 0", warnings
    levels = generate_levels(cfg.lower_price, cfg.upper_price, cfg.grid_line_count, cfg.grid_mode)
    cells = generate_cells(levels)
    if len(cells) < 1:
        return False, "gridCount too small to form grid cells", warnings
    if cfg.grid_direction not in ("long", "short", "neutral"):
        return False, f"unsupported gridDirection: {cfg.grid_direction}", warnings
    if cfg.initial_position_pct < 0 or cfg.initial_position_pct > 1:
        return False, "initialPositionPct must be between 0 and 100 (or 0–1)", warnings

    # Net-profit guard: a grid cell must cover both entry and exit commissions.
    worst: tuple[float, float, float, float, float] | None = None
    for cell in cells:
        lo = float(cell.lower_price or 0.0)
        hi = float(cell.upper_price or 0.0)
        if lo <= 0 or hi <= lo:
            continue
        gross_per_unit = hi - lo
        round_trip_fee_per_unit = (lo + hi) * max(0.0, float(fee_rate or 0.0))
        required = round_trip_fee_per_unit * MIN_GRID_FEE_COVERAGE_MULTIPLIER
        margin = gross_per_unit - required
        if worst is None or margin < worst[0]:
            worst = (margin, lo, hi, gross_per_unit, required)
    if worst is not None and worst[0] <= 0:
        _, lo, hi, gross, required = worst
        gross_pct = (gross / lo * 100.0) if lo > 0 else 0.0
        required_pct = (required / lo * 100.0) if lo > 0 else 0.0
        return (
            False,
            "Grid spacing is too narrow after fees: "
            f"worst cell [{lo:.4f}, {hi:.4f}] captures ~{gross_pct:.3f}% "
            f"but needs ~{required_pct:.3f}% to cover round-trip fees "
            f"({_fee_rate_pct(fee_rate):.3f}% per side plus safety buffer). "
            "Widen the price range, reduce gridCount, or lower fee settings.",
            warnings,
        )
    min_spread = float(cfg.min_spread_between_orders or 0.0)
    if min_spread > 0:
        for cell in cells:
            lo = float(cell.lower_price or 0.0)
            hi = float(cell.upper_price or 0.0)
            if lo <= 0 or hi <= lo:
                continue
            cell_spread = (hi - lo) / lo
            if cell_spread < min_spread:
                return (
                    False,
                    "Grid spacing is below minSpreadBetweenOrders: "
                    f"cell [{lo:.4f}, {hi:.4f}] is {cell_spread * 100:.3f}% "
                    f"but requires at least {min_spread * 100:.3f}%.",
                    warnings,
                )

    if initial_capital > 0 and cfg.initial_position_pct > 0:
        init_usdt = initial_capital * cfg.initial_position_pct
        if init_usdt < effective_amount_per_grid * 0.5:
            warnings.append(
                "Initial position "
                f"(~{init_usdt:.2f} USDT) is small vs amountPerGrid "
                f"({effective_amount_per_grid:.2f})"
            )

    return True, "", warnings
