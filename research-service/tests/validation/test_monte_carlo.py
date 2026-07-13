from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.validation.models import MonteCarloConfig, MonteCarloMethod
from app.validation.monte_carlo import run_monte_carlo

RETURNS = [0.02, -0.01, 0.015, -0.005, 0.01] * 6


def test_trade_order_permutation_is_seeded_and_preserves_terminal_return() -> None:
    config = MonteCarloConfig(
        method=MonteCarloMethod.TRADE_ORDER_PERMUTATION,
        simulations=100,
        seed=17,
    )

    first = run_monte_carlo(RETURNS, config)
    second = run_monte_carlo(RETURNS, config)

    assert first == second
    assert first.null_hypothesis
    assert first.p_value is not None
    assert first.terminal_return_distribution.minimum == pytest.approx(
        first.observed_terminal_return
    )
    assert first.terminal_return_distribution.maximum == pytest.approx(
        first.observed_terminal_return
    )


def test_trade_return_bootstrap_is_deterministic_and_reports_distribution() -> None:
    config = MonteCarloConfig(
        method=MonteCarloMethod.TRADE_RETURN_BOOTSTRAP,
        simulations=100,
        seed=99,
    )

    result = run_monte_carlo(RETURNS, config)

    assert result == run_monte_carlo(RETURNS, config)
    assert result.p_value is None
    assert result.terminal_return_distribution.minimum < result.terminal_return_distribution.maximum
    assert "IID" in " ".join(result.assumptions)


def test_execution_cost_stress_uses_bounded_cost_multipliers() -> None:
    gross_returns = [0.012, 0.009, -0.004, 0.015, 0.007] * 6
    costs = [0.001] * len(gross_returns)
    config = MonteCarloConfig(
        method=MonteCarloMethod.EXECUTION_COST_STRESS,
        simulations=100,
        seed=7,
        cost_stress_min_multiplier=1.0,
        cost_stress_max_multiplier=4.0,
    )

    result = run_monte_carlo(gross_returns, config, costs=costs)

    assert result == run_monte_carlo(gross_returns, config, costs=costs)
    assert result.terminal_return_distribution.maximum <= result.observed_terminal_return
    assert result.probability_of_loss == 0.0
    assert "cost" in result.null_hypothesis.lower()


def test_monte_carlo_rejects_insufficient_or_invalid_observations() -> None:
    config = MonteCarloConfig(
        method=MonteCarloMethod.TRADE_RETURN_BOOTSTRAP,
        simulations=100,
    )
    with pytest.raises(ValueError, match="at least 20"):
        run_monte_carlo([0.01] * 19, config)
    with pytest.raises(ValueError, match="greater than -1"):
        run_monte_carlo([0.01] * 19 + [-1.0], config)


def test_cost_stress_requires_aligned_non_negative_costs() -> None:
    config = MonteCarloConfig(
        method=MonteCarloMethod.EXECUTION_COST_STRESS,
        simulations=100,
    )
    with pytest.raises(ValueError, match="requires per-trade costs"):
        run_monte_carlo(RETURNS, config)
    with pytest.raises(ValueError, match="one value per"):
        run_monte_carlo(RETURNS, config, costs=[0.001])
    with pytest.raises(ValueError, match="non-negative"):
        run_monte_carlo(RETURNS, config, costs=[-0.001] * len(RETURNS))


def test_monte_carlo_config_forbids_unknown_fields_and_unbounded_simulations() -> None:
    with pytest.raises(ValidationError):
        MonteCarloConfig.model_validate(
            {
                "method": "trade_return_bootstrap",
                "simulations": 100,
                "unknown": True,
            }
        )
    with pytest.raises(ValidationError):
        MonteCarloConfig(
            method=MonteCarloMethod.TRADE_RETURN_BOOTSTRAP,
            simulations=10_001,
        )
