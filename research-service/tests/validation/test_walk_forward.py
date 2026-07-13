from __future__ import annotations

import pytest

from app.validation.models import WalkForwardConfig
from app.validation.walk_forward import run_walk_forward


def _equity(count: int) -> list[float]:
    values = [100.0]
    for index in range(1, count):
        change = 1.01 if index % 5 else 0.98
        values.append(values[-1] * change)
    return values


def test_walk_forward_windows_are_sequential_and_non_overlapping() -> None:
    config = WalkForwardConfig(
        training_observations=4,
        validation_observations=3,
        out_of_sample_observations=3,
        minimum_windows=2,
        maximum_windows=3,
    )

    result = run_walk_forward(_equity(32), config)

    assert len(result.windows) == 3
    assert result.non_overlapping is True
    assert result.fixed_strategy_only is True
    assert result.observations_used == 30
    assert result.unused_observations == 2
    assert result.windows[0].training.start_index == 0
    assert result.windows[0].training.end_index == 4
    assert result.windows[0].validation.start_index == 4
    assert result.windows[0].out_of_sample.start_index == 7
    assert result.windows[1].training.start_index == 10


def test_walk_forward_rejects_incomplete_minimum_windows() -> None:
    config = WalkForwardConfig(
        training_observations=4,
        validation_observations=3,
        out_of_sample_observations=3,
        minimum_windows=2,
    )

    with pytest.raises(ValueError, match="at least 20"):
        run_walk_forward(_equity(19), config)


def test_walk_forward_does_not_hide_unused_trailing_data() -> None:
    config = WalkForwardConfig(
        training_observations=2,
        validation_observations=2,
        out_of_sample_observations=2,
        maximum_windows=1,
    )

    result = run_walk_forward(_equity(20), config)

    assert len(result.windows) == 1
    assert result.observations_used == 6
    assert result.unused_observations == 14
    assert any("unused" in assumption for assumption in result.assumptions)
