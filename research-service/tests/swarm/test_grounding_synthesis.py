from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.errors import ServiceError
from app.swarm.grounding import (
    bounded_upstream_output,
    reject_hidden_reasoning_fields,
    validate_output,
    validate_tenant_evidence,
)
from app.swarm.models import (
    ClaimStatus,
    EvidenceReference,
    EvidenceType,
    GroundedClaim,
    GroundedTaskOutput,
    SwarmTask,
    SwarmTaskStatus,
)
from app.swarm.synthesis import synthesize


def _evidence(user_id: int = 1, reference_id: str = "artifact_001") -> EvidenceReference:
    return EvidenceReference(
        evidence_type=EvidenceType.ARTIFACT,
        reference_id=reference_id,
        owner_user_id=user_id,
    )


def _claim(statement: str, value: float, reference: EvidenceReference) -> GroundedClaim:
    return GroundedClaim(
        claim_id=f"claim_{reference.reference_id}",
        statement=statement,
        status=ClaimStatus.SUPPORTED,
        evidence_refs=[reference],
        numeric_values={"value": value},
    )


def _task(task_id: str, role: str, *, required: bool, status: SwarmTaskStatus) -> SwarmTask:
    return SwarmTask(
        task_id=task_id,
        swarm_run_id="swr_test",
        agent_role=role,
        title=task_id,
        objective="test",
        status=status,
        timeout_seconds=10,
        required=required,
    )


def test_supported_claim_requires_evidence() -> None:
    with pytest.raises(ValidationError, match="requires evidence"):
        GroundedClaim(
            claim_id="claim_missing",
            statement="Unsupported fact",
            status=ClaimStatus.SUPPORTED,
        )


def test_cross_tenant_evidence_is_rejected() -> None:
    with pytest.raises(ServiceError, match="tenant"):
        validate_tenant_evidence([_evidence(2)], 1)


def test_numeric_values_and_arabic_text_survive_bounded_projection() -> None:
    reference = _evidence()
    claim = _claim("العائد المحسوب من الأثر", 12.3456789, reference)
    output = GroundedTaskOutput(
        public_summary="ملخص بحثي " * 80,
        calculations=[claim],
        limitations=["قيد موثق"],
        evidence_refs=[reference],
    )
    projected = bounded_upstream_output(output, max_bytes=3_000)
    assert projected.calculations[0].numeric_values["value"] == 12.3456789
    assert projected.calculations[0].statement.startswith("العائد")
    validate_output(projected, 1)


def test_hidden_reasoning_fields_are_rejected_recursively() -> None:
    with pytest.raises(ServiceError, match="hidden reasoning"):
        reject_hidden_reasoning_fields({"safe": [{"chain_of_thought": "private"}]})


def test_partial_synthesis_preserves_supported_findings_and_conflicts() -> None:
    first = _evidence(reference_id="artifact_1")
    second = _evidence(reference_id="artifact_2")
    outputs = {
        "strategy": GroundedTaskOutput(
            public_summary="strategy",
            facts=[_claim("Observed metric", 1.0, first)],
            evidence_refs=[first],
        ),
        "risk": GroundedTaskOutput(
            public_summary="risk",
            facts=[_claim("Observed metric", 2.0, second)],
            limitations=["Risk evidence is bounded."],
            evidence_refs=[second],
        ),
    }
    tasks = [
        _task("strategy", "strategy_analyst", required=True, status=SwarmTaskStatus.SUCCEEDED),
        _task("risk", "risk_reviewer", required=True, status=SwarmTaskStatus.SUCCEEDED),
        _task("dna", "trading_dna_analyst", required=False, status=SwarmTaskStatus.FAILED),
        _task("synthesis", "synthesis_agent", required=True, status=SwarmTaskStatus.RUNNING),
    ]
    result = synthesize(tasks, outputs)
    assert result.completion_status == "partially_completed"
    assert result.conflicting_findings == ["Conflicting numeric evidence: Observed metric"]
    assert [claim.numeric_values["value"] for claim in result.supported_findings] == [2.0, 1.0]
    assert any("Unavailable optional section" in item for item in result.limitations)
    assert len(result.evidence_refs) == 2
