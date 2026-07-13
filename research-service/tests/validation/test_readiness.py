from __future__ import annotations

from app.validation.models import (
    ReadinessEvidence,
    ReadinessPolicy,
    ReadinessStatus,
)
from app.validation.readiness import classify_readiness


def _evidence(**overrides: object) -> ReadinessEvidence:
    values: dict[str, object] = {
        "strategy_valid": True,
        "data_quality_valid": True,
        "trade_count": 250,
        "out_of_sample_windows": 4,
        "maximum_drawdown": 0.10,
        "profit_factor": 1.5,
        "expectancy": 0.01,
        "cost_stress_profitable_probability": 0.90,
        "walk_forward_profitable_fraction": 0.75,
        "bootstrap_expectancy_lower_bound": 0.001,
        "monte_carlo_probability_of_loss": 0.05,
        "intrabar_ambiguity_rate": 0.01,
        "sensitivity_stable": True,
    }
    values.update(overrides)
    return ReadinessEvidence.model_validate(values)


def test_invalid_strategy_is_rejected() -> None:
    result = classify_readiness(_evidence(strategy_valid=False))

    assert result.readiness_status is ReadinessStatus.REJECTED
    assert any("invalid" in failure for failure in result.failed_gates)
    assert result.live_trading_authorized is False


def test_low_trade_count_needs_more_data() -> None:
    result = classify_readiness(_evidence(trade_count=10))

    assert result.readiness_status is ReadinessStatus.NEEDS_MORE_DATA
    assert "10 trades" in result.readiness_reasons[0]


def test_valid_but_weak_evidence_is_experimental() -> None:
    result = classify_readiness(_evidence(trade_count=25, profit_factor=0.8))

    assert result.readiness_status is ReadinessStatus.EXPERIMENTAL
    assert result.failed_gates


def test_paper_and_demo_classifications_are_gate_driven() -> None:
    paper = classify_readiness(
        _evidence(trade_count=75, out_of_sample_windows=0, sensitivity_stable=None)
    )
    demo = classify_readiness(_evidence(trade_count=150, out_of_sample_windows=2))

    assert paper.readiness_status is ReadinessStatus.PAPER_READY
    assert demo.readiness_status is ReadinessStatus.DEMO_READY
    assert paper.failed_gates
    assert demo.failed_gates


def test_live_candidate_never_authorizes_live_trading() -> None:
    result = classify_readiness(_evidence())

    assert result.readiness_status is ReadinessStatus.LIVE_CANDIDATE
    assert result.live_trading_authorized is False
    assert any("never authorizes" in warning for warning in result.warnings)
    assert any("governance" in reason for reason in result.readiness_reasons)


def test_missing_metrics_are_reported_not_silently_zeroed() -> None:
    evidence = ReadinessEvidence(
        strategy_valid=True,
        data_quality_valid=True,
        trade_count=60,
    )

    result = classify_readiness(evidence)

    assert result.readiness_status is ReadinessStatus.EXPERIMENTAL
    assert "maximum_drawdown is unavailable" in result.warnings
    assert "profit_factor is unavailable" in result.warnings


def test_policy_thresholds_are_configurable() -> None:
    policy = ReadinessPolicy(minimum_experimental_trades=5)
    result = classify_readiness(_evidence(trade_count=10), policy)

    assert result.readiness_status is ReadinessStatus.EXPERIMENTAL
