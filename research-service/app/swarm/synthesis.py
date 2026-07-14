from __future__ import annotations

from app.swarm.models import (
    ClaimStatus,
    FinalSynthesis,
    GroundedClaim,
    GroundedTaskOutput,
    SwarmTask,
    SwarmTaskStatus,
)


def synthesize(tasks: list[SwarmTask], outputs: dict[str, GroundedTaskOutput]) -> FinalSynthesis:
    required_failed = any(
        task.required
        and task.agent_role != "synthesis_agent"
        and task.status is not SwarmTaskStatus.SUCCEEDED
        for task in tasks
    )
    optional_missing = [
        task.title
        for task in tasks
        if not task.required and task.status is not SwarmTaskStatus.SUCCEEDED
    ]
    completion_status = (
        "failed" if required_failed else "partially_completed" if optional_missing else "succeeded"
    )
    task_by_id = {task.task_id: task for task in tasks}
    supported: list[GroundedClaim] = []
    risk: list[GroundedClaim] = []
    strategy: list[GroundedClaim] = []
    validation: list[GroundedClaim] = []
    dna: list[GroundedClaim] = []
    limitations: list[str] = []
    references = []
    artifacts = []
    seen_refs: set[tuple[str, str]] = set()
    observed_values: dict[str, dict[str, int | float | str]] = {}
    conflicts: list[str] = []
    for task_id in sorted(outputs):
        output = outputs[task_id]
        role = task_by_id[task_id].agent_role
        claims = [
            claim
            for claim in [*output.facts, *output.calculations, *output.inferences]
            if claim.status is ClaimStatus.SUPPORTED
        ]
        supported.extend(claims)
        for claim in claims:
            if not claim.numeric_values:
                continue
            previous = observed_values.get(claim.statement)
            if previous is not None and previous != claim.numeric_values:
                conflicts.append(f"Conflicting numeric evidence: {claim.statement}")
            observed_values[claim.statement] = claim.numeric_values
        if role == "risk_reviewer":
            risk.extend(claims)
        elif role in {"strategy_analyst", "backtest_analyst"}:
            strategy.extend(claims)
        elif role == "validation_analyst":
            validation.extend(claims)
        elif role in {"trading_dna_analyst", "shadow_trader_analyst"}:
            dna.extend(claims)
        limitations.extend(output.limitations)
        artifacts.extend(output.artifact_refs)
        for reference in output.evidence_refs:
            key = (reference.evidence_type.value, reference.reference_id)
            if key not in seen_refs:
                references.append(reference)
                seen_refs.add(key)
    limitations.extend(f"Unavailable optional section: {title}." for title in optional_missing)
    summary = {
        "succeeded": "Reviewed tasks produced an evidence-linked bounded synthesis.",
        "partially_completed": "Required research completed; optional sections are unavailable.",
        "failed": "Required research evidence is incomplete; no complete synthesis is available.",
    }[completion_status]
    return FinalSynthesis(
        executive_summary=summary,
        supported_findings=supported,
        conflicting_findings=list(dict.fromkeys(conflicts)),
        risk_findings=risk,
        strategy_findings=strategy,
        validation_findings=validation,
        trading_dna_findings=dna,
        limitations=list(dict.fromkeys(limitations)),
        recommended_next_research=[
            "Resolve every insufficient-evidence or unavailable section before further decisions."
        ],
        evidence_refs=references,
        artifact_refs=artifacts,
        completion_status=completion_status,
    )
