from __future__ import annotations

from app.validation.bootstrap import run_bootstrap
from app.validation.models import (
    MonteCarloMethod,
    ValidationSuiteRequest,
    ValidationSuiteResult,
)
from app.validation.monte_carlo import run_monte_carlo
from app.validation.readiness import classify_readiness
from app.validation.walk_forward import run_walk_forward


def run_validation_suite(request: ValidationSuiteRequest) -> ValidationSuiteResult:
    """Run configured validation stages over simple return/equity value arrays."""

    monte_carlo_results = []
    for config in request.monte_carlo:
        if config.method is MonteCarloMethod.EXECUTION_COST_STRESS:
            if request.gross_trade_returns is None or request.trade_cost_returns is None:
                raise ValueError(
                    "execution_cost_stress requires gross_trade_returns and trade_cost_returns"
                )
            monte_carlo_results.append(
                run_monte_carlo(
                    request.gross_trade_returns,
                    config,
                    costs=request.trade_cost_returns,
                )
            )
        else:
            monte_carlo_results.append(run_monte_carlo(request.trade_returns, config))

    bootstrap_result = None
    if request.bootstrap is not None:
        bootstrap_result = run_bootstrap(request.trade_returns, request.bootstrap)

    walk_forward_result = None
    if request.walk_forward is not None:
        walk_forward_result = run_walk_forward(request.equity_values, request.walk_forward)

    readiness_result = None
    if request.readiness_evidence is not None:
        readiness_result = classify_readiness(request.readiness_evidence, request.readiness_policy)

    return ValidationSuiteResult(
        monte_carlo=monte_carlo_results,
        bootstrap=bootstrap_result,
        walk_forward=walk_forward_result,
        readiness=readiness_result,
        metadata={
            "deterministic": True,
            "trade_return_observations": len(request.trade_returns),
            "equity_observations": len(request.equity_values),
        },
    )
