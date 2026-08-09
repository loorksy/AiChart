"""Grid level arithmetic, pinned to upstream's own test vectors.

The first two cases are lifted verbatim from QuantDinger's
`backend_api_python/tests/test_grid_engine.py:12-23`. If either ever changes,
every grid in the product silently moves.
"""

from __future__ import annotations

from app.engine.bots.config import GridBotConfig
from app.engine.bots.levels import (
    generate_cells,
    generate_levels,
    geospace,
    grid_points,
    linspace,
)


def test_arithmetic_levels_span_the_range_inclusively() -> None:
    levels = generate_levels(90000, 100000, 10, "arithmetic")
    assert len(levels) == 10
    assert levels[0] == 90000
    assert abs(levels[-1] - 100000) < 1e-6


def test_five_lines_make_four_tradable_cells() -> None:
    levels = generate_levels(100, 200, 5, "arithmetic")
    cells = generate_cells(levels)
    assert len(cells) == 4
    assert [cell.index for cell in cells] == [0, 1, 2, 3]
    assert cells[0].lower_price == 100
    assert cells[-1].upper_price == 200


def test_arithmetic_step_divides_by_lines_minus_one() -> None:
    # The divisor is n-1, not n. Off by one here shifts the whole ladder.
    levels = generate_levels(100, 200, 5, "arithmetic")
    assert levels == [100.0, 125.0, 150.0, 175.0, 200.0]


def test_geometric_ratio_is_the_n_minus_one_root() -> None:
    lo, hi, n = 100.0, 200.0, 5
    levels = generate_levels(lo, hi, n, "geometric")
    ratio = (hi / lo) ** (1.0 / (n - 1))
    assert len(levels) == n
    for index, level in enumerate(levels):
        assert abs(level - lo * ratio**index) < 1e-9
    assert abs(levels[-1] - hi) < 1e-9


def test_geometric_falls_back_to_arithmetic_on_non_positive_bounds() -> None:
    # `lo > 0` guards the ratio; a zero lower bound must not raise.
    assert generate_levels(0.0, 100.0, 4, "geometric") == generate_levels(
        0.0, 100.0, 4, "arithmetic"
    )


def test_mode_match_is_exact_lowercase_only() -> None:
    # Anything that is not literally "geometric" is arithmetic. Upstream
    # behaviour, and callers pass user-supplied strings.
    assert generate_levels(100, 200, 5, "GEOMETRIC") == generate_levels(100, 200, 5, "geometric")
    assert generate_levels(100, 200, 5, "geo") == generate_levels(100, 200, 5, "arithmetic")
    assert generate_levels(100, 200, 5, "") == generate_levels(100, 200, 5, "arithmetic")


def test_grid_count_is_floored_at_two_and_inverted_range_is_empty() -> None:
    assert len(generate_levels(100, 200, 0, "arithmetic")) == 2
    assert len(generate_levels(100, 200, 1, "arithmetic")) == 2
    assert generate_levels(200, 100, 5, "arithmetic") == []
    assert generate_levels(100, 100, 5, "arithmetic") == []


def test_degenerate_rungs_are_dropped_not_emitted_as_zero_width() -> None:
    cells = generate_cells([100.0, 100.0, 200.0])
    assert len(cells) == 1
    assert (cells[0].lower_price, cells[0].upper_price) == (100.0, 200.0)
    # The surviving cell keeps its LEVEL-PAIR index (1), not a renumbered 0:
    # cell indexes address boundary pairs, and persisted cells are keyed on
    # them, so compacting them would re-point saved state at a different rung.
    assert cells[0].index == 1
    assert generate_cells([100.0]) == []
    assert generate_cells([]) == []


def test_cell_count_unit_decides_lines_versus_cells() -> None:
    """The one-rung trap: `gridCount` means LINES unless told otherwise."""
    legacy = GridBotConfig.from_trading_config({"bot_params": {"gridCount": 10}})
    assert legacy.grid_count_unit == "lines"
    assert legacy.grid_line_count == 10
    assert legacy.tradable_cell_count == 9

    cells = GridBotConfig.from_trading_config(
        {"bot_params": {"gridCount": 10, "gridCountUnit": "cells"}}
    )
    assert cells.grid_line_count == 11
    assert cells.tradable_cell_count == 10


def test_the_two_generators_agree_when_fed_the_same_meaning() -> None:
    """`grid_points(cells=N)` and `generate_levels(lines=N+1)` must match."""
    cell_count = 8
    from_points = grid_points(100.0, 200.0, cell_count, "arithmetic")
    from_levels = generate_levels(100.0, 200.0, cell_count + 1, "arithmetic")
    assert len(from_points) == cell_count + 1
    for a, b in zip(from_points, from_levels, strict=True):
        assert abs(a - b) < 1e-8

    geo_points = grid_points(100.0, 200.0, cell_count, "geometric")
    geo_levels = generate_levels(100.0, 200.0, cell_count + 1, "geometric")
    for a, b in zip(geo_points, geo_levels, strict=True):
        assert abs(a - b) < 1e-8


def test_preview_spacers_round_to_eight_places() -> None:
    assert linspace(0.0, 1.0, 3) == [0.0, 0.5, 1.0]
    assert linspace(1.0, 3.0, 1) == [2.0]
    assert geospace(1.0, 4.0, 3) == [1.0, 2.0, 4.0]
    # Non-positive bounds fall back rather than raising on the ratio.
    assert geospace(-1.0, 1.0, 3) == linspace(-1.0, 1.0, 3)
