from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.jobs.cancellation import JobCancelled
from app.swarm.models import (
    ClaimStatus,
    GroundedClaim,
    GroundedTaskOutput,
    SwarmRun,
    SwarmTask,
    SwarmUsage,
    WorkerResult,
)

Heartbeat = Callable[[], Awaitable[None]]


class WorkerFailure(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True, slots=True)
class TaskExecutionContext:
    run: SwarmRun
    task: SwarmTask
    upstream: dict[str, GroundedTaskOutput]
    cancelled: asyncio.Event
    heartbeat: Heartbeat


class BoundedResearchWorker:
    """Deterministic public-safe worker; it is intentionally not a ReAct loop."""

    async def run(self, context: TaskExecutionContext) -> WorkerResult:
        task = context.task
        parameters = context.run.parameters
        delay_ms = int(parameters.get("task_delay_ms", 0))
        elapsed = 0
        while elapsed < delay_ms:
            if context.cancelled.is_set():
                raise JobCancelled
            step = min(50, delay_ms - elapsed)
            await asyncio.sleep(step / 1000)
            elapsed += step
            await context.heartbeat()
        if context.cancelled.is_set():
            raise JobCancelled
        fail_roles = set(parameters.get("fail_optional_roles", []))
        if task.agent_role in fail_roles:
            raise WorkerFailure("SWARM_WORKER_FAILED", "reviewed task failure simulation")
        retry_roles = set(parameters.get("retry_once_roles", []))
        if task.agent_role in retry_roles and task.attempt == 1:
            raise WorkerFailure(
                "SWARM_PROVIDER_RETRYABLE",
                "retryable reviewed task failure simulation",
                retryable=True,
            )
        evidence = list(context.run.evidence_refs)
        if evidence:
            claim = GroundedClaim(
                claim_id=f"{task.task_id}.evidence_reviewed",
                statement=f"{task.title} reviewed the supplied tenant-scoped evidence index.",
                status=ClaimStatus.SUPPORTED,
                evidence_refs=evidence,
                numeric_values={"evidence_count": len(evidence)},
            )
            output = GroundedTaskOutput(
                public_summary=(
                    f"{task.title} completed a bounded research review. "
                    "No live-trading authority was evaluated or granted."
                ),
                facts=[claim],
                inferences=[
                    GroundedClaim(
                        claim_id=f"{task.task_id}.bounded_inference",
                        statement="The indexed evidence can support further bounded research.",
                        status=ClaimStatus.SUPPORTED,
                        evidence_refs=evidence,
                    )
                ],
                limitations=[
                    "This output does not independently verify current prices "
                    "or authorize execution."
                ],
                evidence_refs=evidence,
            )
        else:
            output = GroundedTaskOutput(
                public_summary=(
                    f"{task.title} completed, but no tenant-scoped evidence was supplied."
                ),
                hypotheses=[
                    GroundedClaim(
                        claim_id=f"{task.task_id}.insufficient_evidence",
                        statement=(
                            "No evidence-linked market or performance conclusion can be made."
                        ),
                        status=ClaimStatus.INSUFFICIENT_EVIDENCE,
                    )
                ],
                limitations=[
                    "insufficient_evidence",
                    "Live trading is outside the swarm boundary.",
                ],
            )
        encoded = json.dumps(output.model_dump(mode="json"), ensure_ascii=False).encode("utf-8")
        return WorkerResult(output=output, usage=SwarmUsage(token_count=max(1, len(encoded) // 4)))
