from __future__ import annotations

import random
from collections.abc import Callable, Sequence

from app.validation._statistics import (
    compoundable_returns,
    distribution_summary,
    finite_values,
    maximum_drawdown_from_returns,
    terminal_return,
)
from app.validation.models import MonteCarloConfig, MonteCarloMethod, MonteCarloResult

_NULL_HYPOTHESES = {
    MonteCarloMethod.TRADE_ORDER_PERMUTATION: (
        "The observed path-dependent drawdown is no better than a random ordering of the "
        "same realized trade returns."
    ),
    MonteCarloMethod.TRADE_RETURN_BOOTSTRAP: (
        "Future trade returns are exchangeable draws from the empirical distribution of "
        "the observed trade returns."
    ),
    MonteCarloMethod.EXECUTION_COST_STRESS: (
        "The strategy remains profitable when observed per-trade execution costs are "
        "multiplied within the configured bounded stress range."
    ),
}


def run_monte_carlo(
    returns: Sequence[float],
    config: MonteCarloConfig,
    *,
    costs: Sequence[float] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> MonteCarloResult:
    """Run one deterministic, named Monte Carlo method.

    ``returns`` are net trade returns for permutation/bootstrap and gross trade
    returns for execution-cost stress. Cost stress additionally requires
    non-negative per-trade ``costs`` expressed in the same return units.
    """

    normalized_returns = compoundable_returns(returns)
    _require_observations(normalized_returns, config.minimum_observations)
    rng = random.Random(config.seed)  # noqa: S311 - deterministic simulation, not security

    if config.method is MonteCarloMethod.EXECUTION_COST_STRESS:
        observed, simulated = _simulate_cost_stress(
            normalized_returns, costs, config, rng, cancel_check
        )
    elif config.method is MonteCarloMethod.TRADE_ORDER_PERMUTATION:
        observed = normalized_returns
        simulated = []
        for simulation in range(config.simulations):
            if cancel_check is not None and simulation % 64 == 0:
                cancel_check()
            sample = list(normalized_returns)
            rng.shuffle(sample)
            simulated.append(sample)
    else:
        observed = normalized_returns
        simulated = []
        for simulation in range(config.simulations):
            if cancel_check is not None and simulation % 64 == 0:
                cancel_check()
            simulated.append(rng.choices(normalized_returns, k=len(normalized_returns)))

    if cancel_check is not None:
        cancel_check()

    observed_terminal = terminal_return(observed)
    observed_drawdown = maximum_drawdown_from_returns(observed)
    terminal_results = [terminal_return(sample) for sample in simulated]
    drawdown_results = [maximum_drawdown_from_returns(sample) for sample in simulated]
    probability_of_loss = sum(value < 0.0 for value in terminal_results) / len(terminal_results)
    p_value = None
    if config.method is MonteCarloMethod.TRADE_ORDER_PERMUTATION:
        # A smaller drawdown is better. This is the fraction of random paths at
        # least as good as the observed path under the stated null hypothesis.
        p_value = sum(value <= observed_drawdown for value in drawdown_results) / len(
            drawdown_results
        )

    assumptions = [
        (
            "Trade returns are supplied after strategy selection and are not treated as "
            "causal evidence."
        ),
        "Simulation results describe uncertainty under the named null hypothesis only.",
    ]
    if config.method is MonteCarloMethod.TRADE_RETURN_BOOTSTRAP:
        assumptions.append("Trade-return bootstrap is IID and does not preserve serial dependence.")
    if config.method is MonteCarloMethod.EXECUTION_COST_STRESS:
        assumptions.append("One cost multiplier is sampled per simulated path.")

    return MonteCarloResult(
        method=config.method,
        null_hypothesis=_NULL_HYPOTHESES[config.method],
        seed=config.seed,
        simulations=config.simulations,
        observations=len(observed),
        observed_terminal_return=observed_terminal,
        observed_maximum_drawdown=observed_drawdown,
        terminal_return_distribution=distribution_summary(terminal_results, config.confidence),
        maximum_drawdown_distribution=distribution_summary(drawdown_results, config.confidence),
        probability_of_loss=probability_of_loss,
        p_value=p_value,
        assumptions=assumptions,
    )


def _simulate_cost_stress(
    gross_returns: list[float],
    costs: Sequence[float] | None,
    config: MonteCarloConfig,
    rng: random.Random,
    cancel_check: Callable[[], None] | None,
) -> tuple[list[float], list[list[float]]]:
    if costs is None:
        raise ValueError("execution_cost_stress requires per-trade costs")
    normalized_costs = finite_values(costs, label="costs")
    if len(normalized_costs) != len(gross_returns):
        raise ValueError("costs must contain one value per gross trade return")
    if any(cost < 0.0 for cost in normalized_costs):
        raise ValueError("costs must be non-negative")

    maximum_multiplier = config.cost_stress_max_multiplier
    if any(
        gross - cost * maximum_multiplier <= -1.0
        for gross, cost in zip(gross_returns, normalized_costs, strict=True)
    ):
        raise ValueError("maximum stressed cost would produce an uncompoundable return <= -1")

    observed = [
        gross - cost * config.cost_stress_min_multiplier
        for gross, cost in zip(gross_returns, normalized_costs, strict=True)
    ]
    simulated = []
    for simulation in range(config.simulations):
        if cancel_check is not None and simulation % 64 == 0:
            cancel_check()
        multiplier = rng.uniform(
            config.cost_stress_min_multiplier, config.cost_stress_max_multiplier
        )
        simulated.append(
            [
                gross - cost * multiplier
                for gross, cost in zip(gross_returns, normalized_costs, strict=True)
            ]
        )
    return observed, simulated


def _require_observations(values: Sequence[float], minimum: int) -> None:
    if len(values) < minimum:
        raise ValueError(f"at least {minimum} trade-return observations are required")
