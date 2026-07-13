from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.validation.models import (
    BootstrapConfig,
    BootstrapMetric,
    MonteCarloConfig,
    MonteCarloMethod,
    ValidationSuiteRequest,
    WalkForwardConfig,
)
from app.validation.runner import run_validation_suite


def test_validation_suite_runs_configured_stages_deterministically() -> None:
    trade_returns = [0.02, -0.01, 0.015, -0.005, 0.01] * 6
    equity_values = [100.0]
    for value in trade_returns:
        equity_values.append(equity_values[-1] * (1.0 + value))
    request = ValidationSuiteRequest(
        trade_returns=trade_returns,
        equity_values=equity_values,
        monte_carlo=[
            MonteCarloConfig(
                method=MonteCarloMethod.TRADE_ORDER_PERMUTATION,
                simulations=100,
                seed=3,
            )
        ],
        bootstrap=BootstrapConfig(
            simulations=100,
            seed=3,
            metrics=[BootstrapMetric.EXPECTANCY],
        ),
        walk_forward=WalkForwardConfig(
            training_observations=4,
            validation_observations=3,
            out_of_sample_observations=3,
        ),
    )

    first = run_validation_suite(request)
    second = run_validation_suite(request)

    assert first == second
    assert len(first.monte_carlo) == 1
    assert first.bootstrap is not None
    assert first.walk_forward is not None
    assert first.metadata["deterministic"] is True


def test_validation_suite_requires_explicit_cost_inputs_for_cost_stress() -> None:
    request = ValidationSuiteRequest(
        monte_carlo=[
            MonteCarloConfig(
                method=MonteCarloMethod.EXECUTION_COST_STRESS,
                simulations=100,
            )
        ]
    )
    with pytest.raises(ValueError, match="requires gross_trade_returns"):
        run_validation_suite(request)


def test_validation_suite_rejects_duplicate_methods_and_non_finite_values() -> None:
    config = MonteCarloConfig(
        method=MonteCarloMethod.TRADE_RETURN_BOOTSTRAP,
        simulations=100,
    )
    with pytest.raises(ValidationError, match="unique"):
        ValidationSuiteRequest(monte_carlo=[config, config])
    with pytest.raises(ValidationError, match="finite"):
        ValidationSuiteRequest(trade_returns=[float("nan")])
