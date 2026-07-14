from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.jobs import ArtifactReference


class SwarmRunStatus(StrEnum):
    DRAFT = "draft"
    QUEUED = "queued"
    RUNNING = "running"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    PARTIALLY_COMPLETED = "partially_completed"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    TIMED_OUT = "timed_out"


class SwarmTaskStatus(StrEnum):
    PENDING = "pending"
    BLOCKED = "blocked"
    READY = "ready"
    RUNNING = "running"
    RETRY_WAIT = "retry_wait"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    SKIPPED = "skipped"
    TIMED_OUT = "timed_out"


RUN_TERMINAL_STATES = {
    SwarmRunStatus.CANCELLED,
    SwarmRunStatus.PARTIALLY_COMPLETED,
    SwarmRunStatus.SUCCEEDED,
    SwarmRunStatus.FAILED,
    SwarmRunStatus.TIMED_OUT,
}
TASK_TERMINAL_STATES = {
    SwarmTaskStatus.SUCCEEDED,
    SwarmTaskStatus.FAILED,
    SwarmTaskStatus.CANCELLED,
    SwarmTaskStatus.SKIPPED,
    SwarmTaskStatus.TIMED_OUT,
}


class EvidenceType(StrEnum):
    CANONICAL_RECOMMENDATION = "canonical_recommendation"
    TRADE = "trade"
    LEARNING_EVENT = "learning_event"
    TRADING_DNA_SNAPSHOT = "trading_dna_snapshot"
    SHADOW_RECOMMENDATION = "shadow_recommendation"
    RESEARCH_JOB = "research_job"
    ARTIFACT = "artifact"
    DATASET_HASH = "dataset_hash"
    STRATEGY_HASH = "strategy_hash"
    BACKTEST_RUN = "backtest_run"
    VALIDATION_ARTIFACT = "validation_artifact"
    MARKET_DATA_SNAPSHOT = "market_data_snapshot"


class EvidenceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidence_type: EvidenceType
    reference_id: str = Field(min_length=3, max_length=160, pattern=r"^[A-Za-z0-9._:-]+$")
    owner_user_id: int = Field(gt=0)
    artifact_id: str | None = Field(default=None, min_length=3, max_length=160)


class ClaimStatus(StrEnum):
    SUPPORTED = "supported"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class GroundedClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim_id: str = Field(min_length=3, max_length=100, pattern=r"^[A-Za-z0-9._:-]+$")
    statement: str = Field(min_length=1, max_length=2_000)
    status: ClaimStatus
    evidence_refs: list[EvidenceReference] = Field(default_factory=list, max_length=32)
    numeric_values: dict[str, int | float | str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def supported_claim_has_evidence(self) -> GroundedClaim:
        if self.status is ClaimStatus.SUPPORTED and not self.evidence_refs:
            raise ValueError("supported claim requires evidence references")
        return self


class GroundedTaskOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["grounded-task-output-v1"] = "grounded-task-output-v1"
    public_summary: str = Field(min_length=1, max_length=4_000)
    facts: list[GroundedClaim] = Field(default_factory=list, max_length=32)
    calculations: list[GroundedClaim] = Field(default_factory=list, max_length=32)
    inferences: list[GroundedClaim] = Field(default_factory=list, max_length=32)
    hypotheses: list[GroundedClaim] = Field(default_factory=list, max_length=32)
    limitations: list[str] = Field(default_factory=list, max_length=32)
    evidence_refs: list[EvidenceReference] = Field(default_factory=list, max_length=64)
    artifact_refs: list[ArtifactReference] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def facts_and_calculations_are_grounded(self) -> GroundedTaskOutput:
        for claim in [*self.facts, *self.calculations]:
            if claim.status is not ClaimStatus.SUPPORTED:
                raise ValueError("facts and calculations must be supported")
        referenced = {(ref.evidence_type, ref.reference_id) for ref in self.evidence_refs}
        for claim in [*self.facts, *self.calculations, *self.inferences, *self.hypotheses]:
            for ref in claim.evidence_refs:
                if (ref.evidence_type, ref.reference_id) not in referenced:
                    raise ValueError("claim evidence must appear in the output evidence index")
        return self


class FinalSynthesis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["research-swarm-synthesis-v1"] = "research-swarm-synthesis-v1"
    executive_summary: str = Field(min_length=1, max_length=4_000)
    supported_findings: list[GroundedClaim] = Field(default_factory=list, max_length=64)
    conflicting_findings: list[str] = Field(default_factory=list, max_length=32)
    risk_findings: list[GroundedClaim] = Field(default_factory=list, max_length=32)
    strategy_findings: list[GroundedClaim] = Field(default_factory=list, max_length=32)
    validation_findings: list[GroundedClaim] = Field(default_factory=list, max_length=32)
    trading_dna_findings: list[GroundedClaim] = Field(default_factory=list, max_length=32)
    limitations: list[str] = Field(default_factory=list, max_length=64)
    recommended_next_research: list[str] = Field(default_factory=list, max_length=32)
    evidence_refs: list[EvidenceReference] = Field(default_factory=list, max_length=128)
    artifact_refs: list[ArtifactReference] = Field(default_factory=list, max_length=32)
    completion_status: Literal["succeeded", "partially_completed", "failed"]


class SwarmBudgets(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token_budget: int = Field(ge=100)
    cost_budget: float = Field(ge=0)
    tool_call_budget: int = Field(ge=0)
    max_workers: int = Field(ge=1)
    max_tasks: int = Field(ge=2)
    max_depth: int = Field(ge=1)
    run_timeout_seconds: int = Field(ge=1)
    task_timeout_seconds: int = Field(ge=1)
    artifact_count: int = Field(ge=1)
    artifact_bytes: int = Field(ge=1024)
    progress_event_count: int = Field(ge=20)


class RequestedSwarmBudgets(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token_budget: int | None = Field(default=None, ge=100)
    cost_budget: float | None = Field(default=None, ge=0)
    tool_call_budget: int | None = Field(default=None, ge=0)
    max_workers: int | None = Field(default=None, ge=1)
    max_tasks: int | None = Field(default=None, ge=2)
    max_depth: int | None = Field(default=None, ge=1)
    run_timeout_seconds: int | None = Field(default=None, ge=1)
    task_timeout_seconds: int | None = Field(default=None, ge=1)
    artifact_count: int | None = Field(default=None, ge=1)
    artifact_bytes: int | None = Field(default=None, ge=1024)
    progress_event_count: int | None = Field(default=None, ge=20)


class SwarmCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preset: str = Field(min_length=3, max_length=80, pattern=r"^[a-z0-9_]+$")
    title: str = Field(min_length=3, max_length=200)
    objective: str = Field(min_length=3, max_length=4_000)
    idempotency_key: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    timeout_seconds: int | None = Field(default=None, ge=1, le=3600)
    max_attempts: int | None = Field(default=None, ge=1, le=6)
    budgets: RequestedSwarmBudgets = Field(default_factory=RequestedSwarmBudgets)
    evidence_refs: list[EvidenceReference] = Field(default_factory=list, max_length=64)
    parameters: dict[str, Any] = Field(default_factory=dict)


class SwarmRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    swarm_run_id: str
    user_id: int
    request_id: str
    idempotency_key: str
    preset: str
    title: str
    objective: str
    status: SwarmRunStatus
    created_at: datetime
    queued_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    timeout_seconds: int
    max_attempts: int
    token_budget: int
    cost_budget: float
    tool_call_budget: int
    max_workers: int
    max_tasks: int
    max_depth: int
    task_timeout_seconds: int
    artifact_count_budget: int
    artifact_bytes_budget: int
    progress_event_count_budget: int
    result_summary: str | None = None
    error_code: str | None = None
    warnings: list[str] = Field(default_factory=list, max_length=64)
    artifact_refs: list[ArtifactReference] = Field(default_factory=list, max_length=32)
    evidence_refs: list[EvidenceReference] = Field(default_factory=list, max_length=64)
    parameters: dict[str, Any] = Field(default_factory=dict, exclude=True)


class SwarmTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_id: str
    swarm_run_id: str
    agent_role: str
    title: str
    objective: str
    dependencies: list[str] = Field(default_factory=list)
    status: SwarmTaskStatus
    attempt: int = 0
    max_attempts: int = 1
    timeout_seconds: int
    required_skills: list[str] = Field(default_factory=list)
    allowed_tools: list[str] = Field(default_factory=list)
    input_refs: list[str] = Field(default_factory=list)
    output_refs: list[str] = Field(default_factory=list)
    progress: int = Field(default=0, ge=0, le=100)
    heartbeat_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_code: str | None = None
    required: bool = True
    retryable: bool = False


class SwarmEvent(BaseModel):
    sequence: int
    swarm_run_id: str
    user_id: int
    event_type: str
    task_id: str | None = None
    timestamp: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class SwarmUsage(BaseModel):
    token_count: int = Field(default=0, ge=0)
    cost: float = Field(default=0, ge=0)
    tool_calls: int = Field(default=0, ge=0)


class WorkerResult(BaseModel):
    output: GroundedTaskOutput
    usage: SwarmUsage = Field(default_factory=SwarmUsage)


class SwarmCreateResponse(BaseModel):
    run: SwarmRun
    created: bool


class SwarmTasksResponse(BaseModel):
    tasks: list[SwarmTask]


class SwarmEventsResponse(BaseModel):
    events: list[SwarmEvent]


class SwarmArtifactsResponse(BaseModel):
    artifacts: list[ArtifactReference]
