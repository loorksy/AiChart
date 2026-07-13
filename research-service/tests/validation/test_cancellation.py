from __future__ import annotations

import pytest

from app.validation.bootstrap import run_bootstrap
from app.validation.models import (
    BootstrapConfig,
    MonteCarloConfig,
    MonteCarloMethod,
    SensitivityConfig,
    SensitivityParameter,
    WalkForwardConfig,
)
from app.validation.monte_carlo import run_monte_carlo
from app.validation.sensitivity import run_sensitivity
from app.validation.walk_forward import run_walk_forward


class CancelledForTest(Exception):
    pass


def cancel() -> None:
    raise CancelledForTest


def test_monte_carlo_checks_for_cancellation_inside_simulation_loop() -> None:
    with pytest.raises(CancelledForTest):
        run_monte_carlo(
            [0.01, -0.005, 0.004] * 10,
            MonteCarloConfig(
                method=MonteCarloMethod.TRADE_RETURN_BOOTSTRAP,
                simulations=1_000,
                minimum_observations=20,
            ),
            cancel_check=cancel,
        )


def test_bootstrap_checks_for_cancellation_inside_resampling_loop() -> None:
    with pytest.raises(CancelledForTest):
        run_bootstrap(
            [0.01, -0.005, 0.004] * 10,
            BootstrapConfig(simulations=1_000, minimum_observations=20),
            cancel_check=cancel,
        )


def test_walk_forward_checks_for_cancellation_between_windows() -> None:
    with pytest.raises(CancelledForTest):
        run_walk_forward(
            [10_000.0 + index for index in range(60)],
            WalkForwardConfig(
                training_observations=5,
                validation_observations=5,
                out_of_sample_observations=5,
            ),
            cancel_check=cancel,
        )


def test_sensitivity_checks_for_cancellation_between_combinations() -> None:
    config = SensitivityConfig(
        parameters=[
            SensitivityParameter(
                name="stop_loss.value",
                base_value=10.0,
                lower_bound=5.0,
                upper_bound=15.0,
                step_count=3,
            )
        ]
    )
    with pytest.raises(CancelledForTest):
        run_sensitivity(config, lambda values: values["stop_loss.value"], cancel_check=cancel)
