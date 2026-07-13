from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.validation.bootstrap import run_bootstrap
from app.validation.models import (
    BootstrapConfig,
    BootstrapMethod,
    BootstrapMetric,
)

RETURNS = [0.02, -0.01, 0.015, -0.005, 0.01] * 8


def test_iid_bootstrap_is_seeded_and_returns_requested_intervals() -> None:
    config = BootstrapConfig(simulations=100, seed=81, confidence=0.90)

    first = run_bootstrap(RETURNS, config)
    second = run_bootstrap(RETURNS, config)

    assert first == second
    assert {interval.metric for interval in first.intervals} == set(BootstrapMetric)
    for interval in first.intervals:
        if interval.observed is not None:
            assert interval.lower is not None
            assert interval.upper is not None
            assert interval.lower <= interval.upper
    assert "IID" in first.null_hypothesis
    assert any("unannualized" in assumption for assumption in first.assumptions)


def test_moving_block_bootstrap_is_explicit_and_deterministic() -> None:
    config = BootstrapConfig(
        simulations=100,
        seed=14,
        method=BootstrapMethod.MOVING_BLOCK,
        block_size=4,
        metrics=[BootstrapMetric.MEAN_TRADE_RETURN, BootstrapMetric.MAXIMUM_DRAWDOWN],
    )

    result = run_bootstrap(RETURNS, config)

    assert result == run_bootstrap(RETURNS, config)
    assert result.block_size == 4
    assert "block" in result.null_hypothesis.lower()
    assert len(result.intervals) == 2


def test_bootstrap_reports_undefined_profit_factor_with_reason() -> None:
    config = BootstrapConfig(
        simulations=100,
        metrics=[BootstrapMetric.PROFIT_FACTOR],
    )

    result = run_bootstrap([0.01] * 20, config)

    interval = result.intervals[0]
    assert interval.observed is None
    assert interval.lower is None
    assert interval.reason is not None
    assert "losing" in interval.reason


def test_bootstrap_rejects_invalid_block_configuration() -> None:
    with pytest.raises(ValidationError, match="requires block_size"):
        BootstrapConfig(method=BootstrapMethod.MOVING_BLOCK, simulations=100)
    with pytest.raises(ValidationError, match="only valid"):
        BootstrapConfig(method=BootstrapMethod.IID, block_size=3, simulations=100)


def test_bootstrap_enforces_observation_and_runtime_block_bounds() -> None:
    with pytest.raises(ValueError, match="at least 20"):
        run_bootstrap(RETURNS[:19], BootstrapConfig(simulations=100))
    config = BootstrapConfig(
        simulations=100,
        minimum_observations=5,
        method=BootstrapMethod.MOVING_BLOCK,
        block_size=10,
    )
    with pytest.raises(ValueError, match="cannot exceed"):
        run_bootstrap(RETURNS[:5], config)


def test_sharpe_is_annualized_only_when_periods_per_year_is_explicit() -> None:
    base = BootstrapConfig(
        simulations=100,
        metrics=[BootstrapMetric.SHARPE],
        seed=4,
    )
    annualized = base.model_copy(update={"periods_per_year": 100})

    unannualized_result = run_bootstrap(RETURNS, base).intervals[0]
    annualized_result = run_bootstrap(RETURNS, annualized).intervals[0]

    assert unannualized_result.observed is not None
    assert annualized_result.observed == pytest.approx(unannualized_result.observed * 10)
