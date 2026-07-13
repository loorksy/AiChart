from __future__ import annotations

from collections.abc import Callable

from app.validation.models import (
    ReadinessEvidence,
    ReadinessPolicy,
    ReadinessResult,
    ReadinessStatus,
)

Gate = tuple[str, Callable[[ReadinessEvidence, ReadinessPolicy], bool]]


def classify_readiness(
    evidence: ReadinessEvidence, policy: ReadinessPolicy | None = None
) -> ReadinessResult:
    """Classify research readiness without granting live-trading authority."""

    active_policy = policy or ReadinessPolicy()
    warnings = _missing_evidence_warnings(evidence)

    rejection_failures = []
    if not evidence.strategy_valid:
        rejection_failures.append("strategy specification is invalid")
    if not evidence.data_quality_valid:
        rejection_failures.append("dataset quality validation failed")
    if rejection_failures:
        return ReadinessResult(
            readiness_status=ReadinessStatus.REJECTED,
            readiness_reasons=["Foundational validity gates failed."],
            failed_gates=rejection_failures,
            warnings=warnings,
        )

    if evidence.trade_count < active_policy.minimum_experimental_trades:
        return ReadinessResult(
            readiness_status=ReadinessStatus.NEEDS_MORE_DATA,
            readiness_reasons=[
                f"Only {evidence.trade_count} trades are available; at least "
                f"{active_policy.minimum_experimental_trades} are required for experimental status."
            ],
            failed_gates=["minimum experimental trade count not met"],
            warnings=warnings,
        )

    paper_failures = _failed_gates(evidence, active_policy, _PAPER_GATES)
    if paper_failures:
        return ReadinessResult(
            readiness_status=ReadinessStatus.EXPERIMENTAL,
            readiness_reasons=[
                "The strategy and dataset are valid, but paper-readiness gates are not all met."
            ],
            failed_gates=paper_failures,
            warnings=warnings,
        )

    demo_failures = _failed_gates(evidence, active_policy, _DEMO_GATES)
    if demo_failures:
        return ReadinessResult(
            readiness_status=ReadinessStatus.PAPER_READY,
            readiness_reasons=[
                (
                    "Paper-readiness gates passed; stronger out-of-sample and robustness "
                    "evidence is required."
                )
            ],
            failed_gates=demo_failures,
            warnings=warnings,
        )

    live_failures = _failed_gates(evidence, active_policy, _LIVE_CANDIDATE_GATES)
    if live_failures:
        return ReadinessResult(
            readiness_status=ReadinessStatus.DEMO_READY,
            readiness_reasons=[
                "Demo-readiness gates passed; the stricter live-candidate research gates did not."
            ],
            failed_gates=live_failures,
            warnings=warnings,
        )

    return ReadinessResult(
        readiness_status=ReadinessStatus.LIVE_CANDIDATE,
        readiness_reasons=[
            "All configured research evidence gates passed.",
            (
                "Independent governance, paper/demo observation, and explicit approval are "
                "still required."
            ),
        ],
        warnings=[
            *warnings,
            "live_candidate is a research label and never authorizes or enables live trading",
        ],
        live_trading_authorized=False,
    )


def _failed_gates(
    evidence: ReadinessEvidence, policy: ReadinessPolicy, gates: tuple[Gate, ...]
) -> list[str]:
    return [message for message, predicate in gates if not predicate(evidence, policy)]


def _missing_evidence_warnings(evidence: ReadinessEvidence) -> list[str]:
    fields = {
        "maximum_drawdown": evidence.maximum_drawdown,
        "profit_factor": evidence.profit_factor,
        "expectancy": evidence.expectancy,
        "cost_stress_profitable_probability": evidence.cost_stress_profitable_probability,
        "walk_forward_profitable_fraction": evidence.walk_forward_profitable_fraction,
        "bootstrap_expectancy_lower_bound": evidence.bootstrap_expectancy_lower_bound,
        "monte_carlo_probability_of_loss": evidence.monte_carlo_probability_of_loss,
        "intrabar_ambiguity_rate": evidence.intrabar_ambiguity_rate,
        "sensitivity_stable": evidence.sensitivity_stable,
    }
    return [f"{name} is unavailable" for name, value in fields.items() if value is None]


_PAPER_GATES: tuple[Gate, ...] = (
    (
        "minimum paper trade count not met",
        lambda evidence, policy: evidence.trade_count >= policy.minimum_paper_trades,
    ),
    (
        "maximum drawdown is missing or exceeds the paper threshold",
        lambda evidence, policy: evidence.maximum_drawdown is not None
        and evidence.maximum_drawdown <= policy.maximum_paper_drawdown,
    ),
    (
        "profit factor is missing or below the paper threshold",
        lambda evidence, policy: evidence.profit_factor is not None
        and evidence.profit_factor >= policy.minimum_paper_profit_factor,
    ),
    (
        "expectancy is missing or non-positive",
        lambda evidence, _policy: evidence.expectancy is not None and evidence.expectancy > 0.0,
    ),
)

_DEMO_GATES: tuple[Gate, ...] = (
    (
        "minimum demo trade count not met",
        lambda evidence, policy: evidence.trade_count >= policy.minimum_demo_trades,
    ),
    (
        "minimum demo out-of-sample windows not met",
        lambda evidence, policy: (
            evidence.out_of_sample_windows >= policy.minimum_demo_oos_windows
        ),
    ),
    (
        "maximum drawdown exceeds the demo threshold",
        lambda evidence, policy: evidence.maximum_drawdown is not None
        and evidence.maximum_drawdown <= policy.maximum_demo_drawdown,
    ),
    (
        "profit factor is below the demo threshold",
        lambda evidence, policy: evidence.profit_factor is not None
        and evidence.profit_factor >= policy.minimum_demo_profit_factor,
    ),
    (
        "cost-stress profitable probability is missing or too low",
        lambda evidence, policy: evidence.cost_stress_profitable_probability is not None
        and evidence.cost_stress_profitable_probability >= policy.minimum_cost_stress_probability,
    ),
    (
        "walk-forward profitable fraction is missing or too low",
        lambda evidence, policy: evidence.walk_forward_profitable_fraction is not None
        and evidence.walk_forward_profitable_fraction
        >= policy.minimum_walk_forward_profitable_fraction,
    ),
    (
        "bootstrap expectancy lower bound is missing or non-positive",
        lambda evidence, _policy: evidence.bootstrap_expectancy_lower_bound is not None
        and evidence.bootstrap_expectancy_lower_bound > 0.0,
    ),
    (
        "intrabar ambiguity rate is missing or too high",
        lambda evidence, policy: evidence.intrabar_ambiguity_rate is not None
        and evidence.intrabar_ambiguity_rate <= policy.maximum_intrabar_ambiguity_rate,
    ),
    (
        "parameter sensitivity is missing or unstable",
        lambda evidence, _policy: evidence.sensitivity_stable is True,
    ),
)

_LIVE_CANDIDATE_GATES: tuple[Gate, ...] = (
    (
        "minimum live-candidate trade count not met",
        lambda evidence, policy: (evidence.trade_count >= policy.minimum_live_candidate_trades),
    ),
    (
        "minimum live-candidate out-of-sample windows not met",
        lambda evidence, policy: (
            evidence.out_of_sample_windows >= policy.minimum_live_candidate_oos_windows
        ),
    ),
    (
        "maximum drawdown exceeds the live-candidate threshold",
        lambda evidence, policy: evidence.maximum_drawdown is not None
        and evidence.maximum_drawdown <= policy.maximum_live_candidate_drawdown,
    ),
    (
        "profit factor is below the live-candidate threshold",
        lambda evidence, policy: evidence.profit_factor is not None
        and evidence.profit_factor >= policy.minimum_live_candidate_profit_factor,
    ),
    (
        "Monte Carlo loss probability is missing or too high",
        lambda evidence, policy: evidence.monte_carlo_probability_of_loss is not None
        and evidence.monte_carlo_probability_of_loss <= policy.maximum_monte_carlo_loss_probability,
    ),
)
