from __future__ import annotations

import math
import statistics
from collections.abc import Callable
from itertools import product

from app.validation.models import (
    SensitivityCombination,
    SensitivityConfig,
    SensitivityOutcome,
    SensitivityParameter,
    SensitivityResult,
)

SensitivityEvaluator = Callable[[dict[str, float]], float]


def generate_combinations(config: SensitivityConfig) -> list[SensitivityCombination]:
    """Generate a bounded deterministic Cartesian grid of numeric parameters."""

    names = [parameter.name for parameter in config.parameters]
    value_grid = [_parameter_values(parameter) for parameter in config.parameters]
    combination_count = math.prod(len(values) for values in value_grid)
    if combination_count > config.maximum_combinations:
        raise ValueError(
            f"sensitivity grid has {combination_count} combinations; "
            f"limit is {config.maximum_combinations}"
        )

    baseline = {parameter.name: parameter.base_value for parameter in config.parameters}
    raw_combinations = [dict(zip(names, values, strict=True)) for values in product(*value_grid)]
    raw_combinations.sort(key=lambda parameters: parameters != baseline)
    return [
        SensitivityCombination(
            combination_number=index,
            parameters=parameters,
            is_baseline=parameters == baseline,
        )
        for index, parameters in enumerate(raw_combinations, start=1)
    ]


def run_sensitivity(
    config: SensitivityConfig,
    evaluator: SensitivityEvaluator,
    *,
    cancel_check: Callable[[], None] | None = None,
) -> SensitivityResult:
    """Evaluate a bounded numeric grid with an internal deterministic evaluator.

    The evaluator is supplied by trusted integration code; parameter values are
    generated only from the validated numeric model and never from expressions,
    source text, imports, or user-defined executable code.
    """

    combinations = generate_combinations(config)
    outcomes = []
    for combination in combinations:
        if cancel_check is not None:
            cancel_check()
        score = float(evaluator(dict(combination.parameters)))
        if not math.isfinite(score):
            raise ValueError(
                f"sensitivity evaluator returned a non-finite score for combination "
                f"{combination.combination_number}"
            )
        outcomes.append(
            SensitivityOutcome(
                **combination.model_dump(),
                score=score,
            )
        )

    if cancel_check is not None:
        cancel_check()
    return summarize_sensitivity(config, outcomes)


def summarize_sensitivity(
    config: SensitivityConfig,
    outcomes: list[SensitivityOutcome],
) -> SensitivityResult:
    """Summarize outcomes produced by either synchronous or async trusted evaluators."""

    if not outcomes:
        raise ValueError("sensitivity outcomes cannot be empty")
    baseline_score = next(outcome.score for outcome in outcomes if outcome.is_baseline)
    scores = [outcome.score for outcome in outcomes]
    positive_fraction = sum(score > 0.0 for score in scores) / len(scores)
    warnings = []
    worst_relative_degradation = None
    degradation_is_acceptable = False
    if baseline_score == 0.0:
        warnings.append("relative degradation is undefined because the baseline score is zero")
    else:
        worst_relative_degradation = max(
            max(0.0, (baseline_score - score) / abs(baseline_score)) for score in scores
        )
        degradation_is_acceptable = (
            worst_relative_degradation <= config.maximum_relative_degradation
        )

    return SensitivityResult(
        combinations=outcomes,
        baseline_score=baseline_score,
        minimum_score=min(scores),
        median_score=statistics.median(scores),
        maximum_score=max(scores),
        positive_fraction=positive_fraction,
        worst_relative_degradation=worst_relative_degradation,
        stable=(
            degradation_is_acceptable and positive_fraction >= config.minimum_positive_fraction
        ),
        warnings=warnings,
    )


def _parameter_values(parameter: SensitivityParameter) -> list[float]:
    interval = (parameter.upper_bound - parameter.lower_bound) / (parameter.step_count - 1)
    values = [parameter.lower_bound + interval * index for index in range(parameter.step_count)]
    values.append(parameter.base_value)
    return sorted(set(values))
