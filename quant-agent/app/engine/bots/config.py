"""Grid bot configuration — the camelCase `bot_params` vocabulary.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger), Copyright
Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Source:
`backend_api_python/app/services/grid/config.py` (the whole file).

Changed on port: `Dict`/`Optional` became builtin generics; `_pct`, `_float` and
`_int` are exported without the leading underscore because `ladders.py` and the
API layer need them and a private-by-convention name copied into three modules
is worse than one shared name. Every coercion, default, alias and clamp is
unchanged.

Two upstream traps are preserved deliberately and must not be "fixed":

  * `grid_count` counts BOUNDARY LINES unless `gridCountUnit == "cells"`. The
    default is `"lines"`, which is what every legacy saved bot means.
  * `pct()` treats any value above 1.0 as a percentage. `initialPositionPct: 1`
    is therefore 100%, not 1%. Upstream's OTHER percent helper
    (`ladders.ratio`) uses the same `> 1 → /100` heuristic but does NOT clamp
    negatives away. Both are reproduced; they are not interchangeable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def to_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return float(default)


def to_int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return int(default)


def pct(v: Any, default: float = 0.0) -> float:
    """Accept 30 or 0.3 for 30%."""
    x = to_float(v, default)
    if x > 1.0:
        return x / 100.0
    return max(0.0, x)


def sanitize_grid_bot_params(bot_params: dict[str, Any] | None) -> dict[str, Any]:
    """Neutral grids do not use initial market position; clear stale pct from UI saves."""
    bp = dict(bot_params) if isinstance(bot_params, dict) else {}
    direction = str(bp.get("gridDirection") or bp.get("grid_direction") or "long").strip().lower()
    if direction == "neutral":
        bp["initialPositionPct"] = 0
        bp.pop("initial_position_pct", None)
    return bp


@dataclass
class GridBotConfig:
    upper_price: float
    lower_price: float
    grid_count: int
    amount_per_grid: float
    grid_mode: str
    grid_direction: str
    initial_position_pct: float
    order_mode: str
    boundary_action: str
    leverage: float
    market_type: str
    margin_mode: str
    grid_count_unit: str = "lines"
    max_open_orders: int = 999999
    min_spread_between_orders: float = 0.0
    order_frequency: int = 0
    amount_per_grid_pct: float = 0.0

    @classmethod
    def from_trading_config(cls, trading_config: dict[str, Any]) -> GridBotConfig:
        tc = trading_config if isinstance(trading_config, dict) else {}
        raw_params = tc.get("bot_params")
        bp = sanitize_grid_bot_params(raw_params if isinstance(raw_params, dict) else {})
        upper = to_float(bp.get("upperPrice") or bp.get("upper_price"), 0.0)
        lower = to_float(bp.get("lowerPrice") or bp.get("lower_price"), 0.0)
        direction = str(
            bp.get("gridDirection") or bp.get("grid_direction") or "long"
        ).strip().lower()
        if direction not in ("long", "short", "neutral"):
            direction = "long"
        order_mode = str(
            bp.get("orderMode") or bp.get("order_mode") or tc.get("order_mode") or "maker"
        ).strip().lower()
        boundary = str(
            bp.get("boundaryAction") or bp.get("boundary_action") or "pause"
        ).strip().lower()
        if boundary not in ("pause", "stop_loss", "hold"):
            boundary = "pause"
        mt = str(tc.get("market_type") or "swap").strip().lower()
        if mt in ("futures", "future", "perp", "perpetual"):
            mt = "swap"
        count_unit = str(
            bp.get("gridCountUnit") or bp.get("grid_count_unit") or "lines"
        ).strip().lower()
        if count_unit not in ("lines", "cells"):
            count_unit = "lines"
        return cls(
            upper_price=upper,
            lower_price=lower,
            grid_count=max(2, to_int(bp.get("gridCount") or bp.get("grid_count"), 10)),
            amount_per_grid=to_float(bp.get("amountPerGrid") or bp.get("amount_per_grid"), 0.0),
            amount_per_grid_pct=pct(
                bp.get("amountPerGridPct") or bp.get("amount_per_grid_pct"), 0.0
            ),
            grid_mode=str(bp.get("gridMode") or bp.get("grid_mode") or "arithmetic")
            .strip()
            .lower(),
            grid_direction=direction,
            initial_position_pct=pct(
                bp.get("initialPositionPct") or bp.get("initial_position_pct"), 0.0
            ),
            order_mode=order_mode,
            boundary_action=boundary,
            leverage=max(1.0, to_float(tc.get("leverage"), 1.0)),
            market_type=mt,
            margin_mode=str(tc.get("margin_mode") or tc.get("marginMode") or "cross")
            .strip()
            .lower(),
            grid_count_unit=count_unit,
            max_open_orders=max(
                1, to_int(bp.get("maxOpenOrders") or bp.get("max_open_orders"), 999999)
            ),
            min_spread_between_orders=pct(
                bp.get("minSpreadBetweenOrders") or bp.get("min_spread_between_orders"), 0.0
            ),
            order_frequency=max(
                0, to_int(bp.get("orderFrequency") or bp.get("order_frequency"), 0)
            ),
        )

    @property
    def grid_line_count(self) -> int:
        """Boundary-line count consumed by the grid engine.

        Saved bots that omitted ``gridCountUnit`` retain the historical
        line-count meaning. Templates that explicitly store ``cells`` get N
        visible cells materialized from N + 1 boundaries.
        """
        return self.grid_count + 1 if self.grid_count_unit == "cells" else self.grid_count

    @property
    def tradable_cell_count(self) -> int:
        return max(1, self.grid_line_count - 1)

    def effective_bounds(self, runtime_params: dict[str, Any] | None = None) -> tuple[float, float]:
        """(upper, lower), letting runtime params override without mutating config."""
        rp = runtime_params if isinstance(runtime_params, dict) else {}
        upper = to_float(rp.get("upperPrice"), self.upper_price)
        lower = to_float(rp.get("lowerPrice"), self.lower_price)
        return upper, lower
