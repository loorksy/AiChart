from __future__ import annotations

import math

import pytest
from pydantic import ValidationError

from app.validation.models import SensitivityConfig, SensitivityParameter
from app.validation.sensitivity import generate_combinations, run_sensitivity


def _config(**overrides: object) -> SensitivityConfig:
    values: dict[str, object] = {
        "parameters": [
            SensitivityParameter(
                name="fast_period",
                base_value=20,
                lower_bound=18,
                upper_bound=22,
                step_count=3,
            ),
            SensitivityParameter(
                name="risk_percent",
                base_value=1.0,
                lower_bound=0.5,
                upper_bound=1.5,
                step_count=3,
            ),
        ]
    }
    values.update(overrides)
    return SensitivityConfig.model_validate(values)


def test_sensitivity_grid_is_bounded_numeric_and_contains_one_baseline() -> None:
    combinations = generate_combinations(_config())

    assert len(combinations) == 9
    assert sum(combination.is_baseline for combination in combinations) == 1
    assert combinations[0].is_baseline is True
    assert all(set(item.parameters) == {"fast_period", "risk_percent"} for item in combinations)


def test_sensitivity_rejects_grid_over_configured_combination_limit() -> None:
    with pytest.raises(ValueError, match="limit is 8"):
        generate_combinations(_config(maximum_combinations=8))


def test_sensitivity_scores_stability_instead_of_selecting_only_best() -> None:
    config = _config(maximum_relative_degradation=0.50, minimum_positive_fraction=1.0)

    result = run_sensitivity(
        config,
        lambda parameters: 10.0
        - abs(parameters["fast_period"] - 20.0)
        - abs(parameters["risk_percent"] - 1.0),
    )

    assert result.baseline_score == 10.0
    assert result.maximum_score == 10.0
    assert result.minimum_score == 7.5
    assert result.worst_relative_degradation == pytest.approx(0.25)
    assert result.positive_fraction == 1.0
    assert result.stable is True


def test_sensitivity_rejects_non_finite_evaluator_result() -> None:
    with pytest.raises(ValueError, match="non-finite"):
        run_sensitivity(_config(), lambda _parameters: math.inf)


def test_sensitivity_models_reject_categorical_or_duplicate_parameters() -> None:
    with pytest.raises(ValidationError):
        SensitivityParameter.model_validate(
            {
                "name": "period",
                "base_value": "fast",
                "lower_bound": 1,
                "upper_bound": 2,
            }
        )
    duplicate = SensitivityParameter(name="period", base_value=2, lower_bound=1, upper_bound=3)
    with pytest.raises(ValidationError, match="unique"):
        SensitivityConfig(parameters=[duplicate, duplicate])
