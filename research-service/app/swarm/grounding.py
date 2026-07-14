from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from app.errors import ServiceError
from app.swarm.models import EvidenceReference, GroundedClaim, GroundedTaskOutput

_HIDDEN_REASONING_KEYS = {
    "chain_of_thought",
    "chain-of-thought",
    "cot",
    "hidden_reasoning",
    "reasoning_content",
    "private_reasoning",
    "scratchpad",
}


def reject_hidden_reasoning_fields(value: Any) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            if str(key).strip().lower() in _HIDDEN_REASONING_KEYS:
                raise ServiceError(
                    "SWARM_OUTPUT_INVALID", "hidden reasoning fields are forbidden", 422
                )
            reject_hidden_reasoning_fields(item)
    elif isinstance(value, list):
        for item in value:
            reject_hidden_reasoning_fields(item)


def validate_tenant_evidence(references: list[EvidenceReference], user_id: int) -> None:
    if any(reference.owner_user_id != user_id for reference in references):
        raise ServiceError("SWARM_EVIDENCE_INVALID", "evidence is not tenant scoped", 404)
    keys = [(reference.evidence_type, reference.reference_id) for reference in references]
    if len(keys) != len(set(keys)):
        raise ServiceError("SWARM_EVIDENCE_INVALID", "duplicate evidence reference", 422)


def validate_output(output: GroundedTaskOutput, user_id: int) -> None:
    payload = output.model_dump(mode="json")
    reject_hidden_reasoning_fields(payload)
    validate_tenant_evidence(output.evidence_refs, user_id)
    for claim in [*output.facts, *output.calculations, *output.inferences, *output.hypotheses]:
        validate_tenant_evidence(claim.evidence_refs, user_id)


def _encoded_size(output: GroundedTaskOutput) -> int:
    return len(
        json.dumps(
            output.model_dump(mode="json"),
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )


def bounded_upstream_output(
    output: GroundedTaskOutput,
    *,
    max_bytes: int = 16_384,
    max_claims_per_section: int = 8,
    max_limitations: int = 8,
) -> GroundedTaskOutput:
    """Project an output without changing numeric values or evidence identifiers."""
    projected = output.model_copy(
        deep=True,
        update={
            "public_summary": output.public_summary[:2_000],
            "facts": output.facts[:max_claims_per_section],
            "calculations": output.calculations[:max_claims_per_section],
            "inferences": output.inferences[:max_claims_per_section],
            "hypotheses": output.hypotheses[:max_claims_per_section],
            "limitations": output.limitations[:max_limitations],
            "artifact_refs": output.artifact_refs[:8],
        },
    )
    while _encoded_size(projected) > max_bytes:
        sections: list[list[GroundedClaim]] = [
            projected.hypotheses,
            projected.inferences,
            projected.calculations,
            projected.facts,
        ]
        longest = max(sections, key=len)
        if longest:
            longest.pop()
            continue
        if projected.limitations:
            projected.limitations.pop()
            continue
        if len(projected.public_summary) > 256:
            projected.public_summary = projected.public_summary[
                : len(projected.public_summary) // 2
            ]
            continue
        raise ServiceError("SWARM_OUTPUT_INVALID", "upstream output exceeds safe limit", 413)
    used = {
        (reference.evidence_type, reference.reference_id)
        for claim in [
            *projected.facts,
            *projected.calculations,
            *projected.inferences,
            *projected.hypotheses,
        ]
        for reference in claim.evidence_refs
    }
    projected.evidence_refs = [
        reference
        for reference in projected.evidence_refs
        if (reference.evidence_type, reference.reference_id) in used
    ]
    return projected
