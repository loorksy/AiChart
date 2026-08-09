"""Grid level and cell generation — the arithmetic every grid surface agrees on.

Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger), Copyright
Open Byte Inc., licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). Sources:
`backend_api_python/app/services/grid/levels.py` (the whole file) and the second,
independent generator in `.../app/services/strategy_runtime/executors.py`
(`_linspace`, `_geospace`, `_grid_points`).

Changed on port: nothing arithmetic. `List[float]` became `list[float]` for
ruff's `UP` rules, and the two upstream generators — which live in different
packages and are easy to mistake for each other — are placed side by side here
with the difference spelled out, because getting it wrong shifts a whole grid by
one rung:

  * `generate_levels(lower, upper, n, mode)` divides by `n - 1`. Its `n` counts
    BOUNDARY LINES. N lines bound N-1 cells.
  * `grid_points(start, end, cells, mode)` returns `cells + 1` points. Its count
    is a CELL count, and it reaches `generate_levels`' arithmetic by asking for
    `cells + 1` lines.

They agree numerically whenever `generate_levels` is fed
`GridBotConfig.grid_line_count`; `grid_points` additionally rounds to 8 dp
because it feeds a preview table rather than an order price.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class GridCellSpec:
    """One rung: the price band between two adjacent boundary lines."""

    index: int
    lower_price: float
    upper_price: float


def generate_levels(lower: float, upper: float, grid_count: int, mode: str) -> list[float]:
    """Generate ``grid_count`` boundary lines.

    The long-standing live-grid storage contract treats ``grid_count`` as a
    boundary-line count. Templates that expose a cell count convert it through
    :attr:`GridBotConfig.grid_line_count` before calling here.

    Mode matching is `.lower()` and exact: anything that is not literally
    ``"geometric"`` falls through to arithmetic, including ``"geo"`` and
    ``"Geometric "``. That is upstream's behaviour and callers depend on it.
    """
    n = max(2, int(grid_count or 2))
    lo, hi = float(lower), float(upper)
    if hi <= lo:
        return []
    if str(mode or "").lower() == "geometric" and lo > 0 and hi > lo:
        ratio = (hi / lo) ** (1.0 / (n - 1))
        return [lo * (ratio**i) for i in range(n)]
    step = (hi - lo) / float(n - 1)
    return [lo + step * i for i in range(n)]


def generate_cells(levels: list[float]) -> list[GridCellSpec]:
    """Pair adjacent levels into cells, dropping degenerate rungs.

    `hi > lo` is strict, so a geometric grid that collapses two lines onto the
    same price yields FEWER than `len(levels) - 1` cells rather than a
    zero-width cell an order could rest inside forever.
    """
    if not levels or len(levels) < 2:
        return []
    out: list[GridCellSpec] = []
    for i in range(len(levels) - 1):
        lo, hi = float(levels[i]), float(levels[i + 1])
        if hi > lo:
            out.append(GridCellSpec(index=i, lower_price=lo, upper_price=hi))
    return out


def linspace(start: float, end: float, count: int) -> list[float]:
    """`count` evenly spaced points, rounded to 8 dp (the preview convention)."""
    if count <= 1:
        return [round((start + end) / 2.0, 8)]
    step = (end - start) / float(count - 1)
    return [round(start + step * i, 8) for i in range(count)]


def geospace(start: float, end: float, count: int) -> list[float]:
    """`count` geometrically spaced points. Falls back to `linspace` when either
    bound is non-positive, since a ratio through zero is undefined."""
    if count <= 1 or start <= 0 or end <= 0:
        return linspace(start, end, count)
    ratio = (end / start) ** (1.0 / float(count - 1))
    return [round(start * (ratio**i), 8) for i in range(count)]


def grid_points(start: float, end: float, cell_count: int, mode: str) -> list[float]:
    """Return ``cell_count + 1`` price lines for an exact number of grid cells."""
    point_count = max(1, int(cell_count or 0)) + 1
    return (
        geospace(start, end, point_count)
        if mode == "geometric"
        else linspace(start, end, point_count)
    )
