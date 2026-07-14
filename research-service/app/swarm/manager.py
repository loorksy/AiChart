from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any

from app.config import Settings
from app.core.ids import opaque_id
from app.core.redaction import contains_rejected_content, redact_text
from app.errors import ServiceError
from app.jobs.cancellation import JobCancelled
from app.logging import log_event
from app.models.jobs import ArtifactReference
from app.security import CallerContext
from app.storage.artifacts import ArtifactStore
from app.swarm.budgets import resolve_budgets, usage_fits
from app.swarm.dag import validate_dag
from app.swarm.grounding import (
    bounded_upstream_output,
    reject_hidden_reasoning_fields,
    validate_output,
    validate_tenant_evidence,
)
from app.swarm.models import (
    RUN_TERMINAL_STATES,
    TASK_TERMINAL_STATES,
    FinalSynthesis,
    GroundedTaskOutput,
    SwarmArtifactsResponse,
    SwarmCreateRequest,
    SwarmRun,
    SwarmRunStatus,
    SwarmTask,
    SwarmTaskStatus,
    SwarmUsage,
)
from app.swarm.policies import ROLE_POLICIES
from app.swarm.presets import build_tasks, get_preset, validate_parameters
from app.swarm.store import SwarmStore
from app.swarm.synthesis import synthesize
from app.swarm.worker import BoundedResearchWorker, TaskExecutionContext, WorkerFailure


def _now() -> datetime:
    return datetime.now(UTC)


class ResearchSwarmManager:
    def __init__(
        self,
        settings: Settings,
        store: SwarmStore,
        artifacts: ArtifactStore,
        worker: BoundedResearchWorker | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.artifacts = artifacts
        self.worker = worker or BoundedResearchWorker()
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=settings.max_queued_jobs)
        self.workers: list[asyncio.Task[None]] = []
        self.run_cancels: dict[str, asyncio.Event] = {}
        self.task_cancels: dict[tuple[str, str], asyncio.Event] = {}
        self.artifact_locks: dict[str, asyncio.Lock] = {}
        self.budget_locks: dict[str, asyncio.Lock] = {}
        self.budget_stops: set[str] = set()
        self.stale_tasks: set[tuple[str, str]] = set()
        self.started = False
        self.accepting = False

    async def start(self) -> None:
        await self.store.initialize()
        await self.store.recover_abandoned()
        self.started = True
        self.accepting = self.settings.swarm_enabled and self.settings.swarm_presets_enabled
        if not self.accepting:
            return
        self.workers = [
            asyncio.create_task(self._worker(index), name=f"swarm-run-worker-{index}")
            for index in range(self.settings.swarm_max_concurrent_runs)
        ]
        for run_id in await self.store.queued_run_ids():
            if self.queue.full():
                await self.store.transition_run(
                    run_id,
                    SwarmRunStatus.FAILED,
                    "run_failed",
                    completed_at=_now(),
                    error_code="SWARM_QUEUE_FULL",
                )
            else:
                self.queue.put_nowait(run_id)

    async def stop(self) -> None:
        self.accepting = False
        for event in self.run_cancels.values():
            event.set()
        for event in self.task_cancels.values():
            event.set()
        try:
            await asyncio.wait_for(self.queue.join(), timeout=5)
        except TimeoutError:
            pass
        for worker in self.workers:
            worker.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)
        self.workers.clear()
        self.started = False

    async def ready(self) -> bool:
        return self.started and await self.store.available()

    async def create(
        self, request: SwarmCreateRequest, context: CallerContext
    ) -> tuple[SwarmRun, bool]:
        if not self.accepting:
            raise ServiceError("SWARM_DISABLED", "Research Swarm is disabled", 503)
        user_content = {
            "title": request.title,
            "objective": request.objective,
            "parameters": request.parameters,
        }
        if (
            contains_rejected_content(user_content)
            or redact_text(request.title) != request.title
            or redact_text(request.objective) != request.objective
        ):
            raise ServiceError("SWARM_INPUT_INVALID", "unsafe swarm input rejected", 422)
        validate_tenant_evidence(request.evidence_refs, context.user_id)
        preset = get_preset(request.preset)
        parameters = validate_parameters(preset, request.parameters)
        budgets = resolve_budgets(self.settings, request.budgets)
        timeout_seconds = request.timeout_seconds or budgets.run_timeout_seconds
        if timeout_seconds > budgets.run_timeout_seconds:
            raise ServiceError("SWARM_BUDGET_INVALID", "timeout exceeds approved budget", 422)
        max_attempts = request.max_attempts or min(2, self.settings.max_retries + 1)
        if max_attempts > self.settings.max_retries + 1:
            raise ServiceError("SWARM_BUDGET_INVALID", "attempts exceed server maximum", 422)
        run_id = opaque_id("swr")
        tasks = build_tasks(
            preset,
            run_id,
            max_attempts=max_attempts,
            task_timeout=budgets.task_timeout_seconds,
        )
        validate_dag(tasks, max_tasks=budgets.max_tasks, max_depth=budgets.max_depth)
        optional_roles = {task.agent_role for task in tasks if not task.required}
        if not set(parameters.get("fail_optional_roles", [])) <= optional_roles:
            raise ServiceError(
                "SWARM_INPUT_INVALID", "only optional roles may use failure simulation", 422
            )
        retryable_roles = {task.agent_role for task in tasks if task.retryable}
        if not set(parameters.get("retry_once_roles", [])) <= retryable_roles:
            raise ServiceError(
                "SWARM_INPUT_INVALID", "retry simulation requires a retryable role", 422
            )
        if self.queue.full():
            raise ServiceError("SWARM_QUEUE_FULL", "research swarm queue is full", 503)
        run, created = await self.store.create_or_get(
            request,
            user_id=context.user_id,
            request_id=context.request_id,
            budgets=budgets,
            tasks=tasks,
            parameters=parameters,
            max_attempts=max_attempts,
            timeout_seconds=timeout_seconds,
        )
        if created:
            self.queue.put_nowait(run.swarm_run_id)
        return run, created

    async def cancel(self, run_id: str, user_id: int) -> SwarmRun:
        lock = self.artifact_locks.setdefault(run_id, asyncio.Lock())
        async with lock:
            run = await self.store.request_cancel(run_id, user_id)
            if run is None:
                raise ServiceError("SWARM_NOT_FOUND", "research swarm run not found", 404)
            self.run_cancels.setdefault(run_id, asyncio.Event()).set()
            for (candidate_run, _), event in self.task_cancels.items():
                if candidate_run == run_id:
                    event.set()
            return run

    async def cancel_optional_task(self, run_id: str, task_id: str, user_id: int) -> SwarmTask:
        run = await self.store.get_for_user(run_id, user_id)
        if run is None:
            raise ServiceError("SWARM_NOT_FOUND", "research swarm run not found", 404)
        tasks = await self.store.tasks_internal(run_id)
        task = next((item for item in tasks if item.task_id == task_id), None)
        if task is None:
            raise ServiceError("SWARM_TASK_NOT_FOUND", "research swarm task not found", 404)
        if task.required:
            raise ServiceError("SWARM_TASK_CANCEL_DENIED", "required task cannot be cancelled", 409)
        if task.status in TASK_TERMINAL_STATES:
            return task
        event = self.task_cancels.setdefault((run_id, task_id), asyncio.Event())
        event.set()
        if task.status is not SwarmTaskStatus.RUNNING:
            return await self.store.transition_task(
                run_id,
                task_id,
                SwarmTaskStatus.CANCELLED,
                "task_cancelled",
                completed_at=_now(),
                error_code="SWARM_TASK_CANCELLED",
            )
        return task

    async def artifacts_for_user(self, run_id: str, user_id: int) -> SwarmArtifactsResponse:
        run = await self.store.get_for_user(run_id, user_id)
        if run is None:
            raise ServiceError("SWARM_NOT_FOUND", "research swarm run not found", 404)
        return SwarmArtifactsResponse(artifacts=run.artifact_refs)

    async def _worker(self, _: int) -> None:
        while True:
            run_id = await self.queue.get()
            try:
                await self._execute_run(run_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                log_event(
                    logging.ERROR,
                    "swarm worker containment failure",
                    swarm_run_id=run_id,
                    error_code="SWARM_FAILED",
                )
                run = await self.store.get_internal(run_id)
                if run and run.status not in RUN_TERMINAL_STATES:
                    await self.store.transition_run(
                        run_id,
                        SwarmRunStatus.FAILED,
                        "run_failed",
                        completed_at=_now(),
                        error_code="SWARM_FAILED",
                    )
            finally:
                self.run_cancels.pop(run_id, None)
                self.budget_stops.discard(run_id)
                self.queue.task_done()

    async def _execute_run(self, run_id: str) -> None:
        run = await self.store.get_internal(run_id)
        if run is None or run.status in RUN_TERMINAL_STATES:
            return
        cancelled = self.run_cancels.setdefault(run_id, asyncio.Event())
        run = await self.store.transition_run(
            run_id,
            SwarmRunStatus.RUNNING,
            "run_started",
            started_at=_now(),
        )
        try:
            await self._write_initial_artifacts(run)
            async with asyncio.timeout(run.timeout_seconds):
                await self._schedule(run, cancelled)
            if cancelled.is_set():
                raise JobCancelled
            await self._finalize_success(run_id)
        except JobCancelled:
            await self._cancel_remaining_tasks(run_id)
            current = await self.store.get_internal(run_id)
            if current and current.status not in RUN_TERMINAL_STATES:
                if current.status is not SwarmRunStatus.CANCELLING:
                    await self.store.transition_run(
                        run_id, SwarmRunStatus.CANCELLING, "run_cancelling"
                    )
                await self.store.transition_run(
                    run_id,
                    SwarmRunStatus.CANCELLED,
                    "run_cancelled",
                    completed_at=_now(),
                    cancelled_at=_now(),
                    error_code="SWARM_CANCELLED",
                )
        except TimeoutError:
            await self._terminalize_tasks(run_id, SwarmTaskStatus.TIMED_OUT, "SWARM_TIMEOUT")
            await self.store.transition_run(
                run_id,
                SwarmRunStatus.TIMED_OUT,
                "run_failed",
                completed_at=_now(),
                error_code="SWARM_TIMEOUT",
            )
        except Exception as exc:
            current = await self.store.get_internal(run_id)
            if current and current.status not in RUN_TERMINAL_STATES:
                await self.store.transition_run(
                    run_id,
                    SwarmRunStatus.FAILED,
                    "run_failed",
                    completed_at=_now(),
                    error_code=(exc.code if isinstance(exc, ServiceError) else "SWARM_FAILED"),
                )

    async def _schedule(self, run: SwarmRun, cancelled: asyncio.Event) -> None:
        active: dict[str, asyncio.Task[None]] = {}
        fail_fast = get_preset(run.preset).fail_fast
        try:
            while True:
                if cancelled.is_set():
                    raise JobCancelled
                tasks = await self.store.tasks_internal(run.swarm_run_id)
                by_id = {task.task_id: task for task in tasks}
                required_failed = any(
                    task.required
                    and task.agent_role != "synthesis_agent"
                    and task.status
                    in {
                        SwarmTaskStatus.FAILED,
                        SwarmTaskStatus.CANCELLED,
                        SwarmTaskStatus.TIMED_OUT,
                        SwarmTaskStatus.SKIPPED,
                    }
                    for task in tasks
                )
                if fail_fast and required_failed:
                    for future in active.values():
                        future.cancel()
                    await asyncio.gather(*active.values(), return_exceptions=True)
                    active.clear()
                    await self._skip_unstarted(run.swarm_run_id, "SWARM_FAIL_FAST_REQUIRED_TASK")
                    return
                for task in tasks:
                    if task.status in TASK_TERMINAL_STATES | {
                        SwarmTaskStatus.READY,
                        SwarmTaskStatus.RUNNING,
                        SwarmTaskStatus.RETRY_WAIT,
                    }:
                        continue
                    if task.agent_role == "synthesis_agent":
                        others = [item for item in tasks if item.task_id != task.task_id]
                        if not all(item.status in TASK_TERMINAL_STATES for item in others):
                            continue
                        if any(
                            item.required and item.status is not SwarmTaskStatus.SUCCEEDED
                            for item in others
                        ):
                            await self.store.transition_task(
                                run.swarm_run_id,
                                task.task_id,
                                SwarmTaskStatus.SKIPPED,
                                "task_failed",
                                completed_at=_now(),
                                error_code="SWARM_REQUIRED_DEPENDENCY_FAILED",
                            )
                        else:
                            await self.store.transition_task(
                                run.swarm_run_id,
                                task.task_id,
                                SwarmTaskStatus.READY,
                                "task_ready",
                            )
                        continue
                    dependencies = [by_id[dependency] for dependency in task.dependencies]
                    if any(
                        item.status in TASK_TERMINAL_STATES
                        and item.status is not SwarmTaskStatus.SUCCEEDED
                        for item in dependencies
                    ):
                        await self.store.transition_task(
                            run.swarm_run_id,
                            task.task_id,
                            SwarmTaskStatus.SKIPPED,
                            "task_failed",
                            completed_at=_now(),
                            error_code="SWARM_REQUIRED_DEPENDENCY_FAILED",
                        )
                    elif all(item.status is SwarmTaskStatus.SUCCEEDED for item in dependencies):
                        await self.store.transition_task(
                            run.swarm_run_id,
                            task.task_id,
                            SwarmTaskStatus.READY,
                            "task_ready",
                        )
                tasks = await self.store.tasks_internal(run.swarm_run_id)
                if run.swarm_run_id in self.budget_stops:
                    for future in active.values():
                        future.cancel()
                    await asyncio.gather(*active.values(), return_exceptions=True)
                    active.clear()
                    await self._skip_unstarted(run.swarm_run_id, "SWARM_BUDGET_EXHAUSTED")
                available = max(0, run.max_workers - len(active))
                for task in sorted(tasks, key=lambda item: item.task_id):
                    if available <= 0:
                        break
                    if task.status is SwarmTaskStatus.READY and task.task_id not in active:
                        active[task.task_id] = asyncio.create_task(
                            self._run_task(run, task),
                            name=f"swarm-{run.swarm_run_id}-{task.task_id}",
                        )
                        available -= 1
                if active:
                    done, _ = await asyncio.wait(
                        active.values(), timeout=0.05, return_when=asyncio.FIRST_COMPLETED
                    )
                    await asyncio.gather(*done, return_exceptions=True)
                    await self._detect_stale(run.swarm_run_id, active)
                    active = {key: future for key, future in active.items() if not future.done()}
                    continue
                tasks = await self.store.tasks_internal(run.swarm_run_id)
                if all(task.status in TASK_TERMINAL_STATES for task in tasks):
                    return
                await asyncio.sleep(0.01)
        finally:
            for future in active.values():
                future.cancel()
            await asyncio.gather(*active.values(), return_exceptions=True)

    async def _run_task(self, run: SwarmRun, task: SwarmTask) -> None:
        task_event = self.task_cancels.setdefault((run.swarm_run_id, task.task_id), asyncio.Event())
        try:
            task = await self.store.transition_task(
                run.swarm_run_id,
                task.task_id,
                SwarmTaskStatus.RUNNING,
                "task_started",
                attempt=task.attempt + 1,
                started_at=task.started_at or _now(),
                heartbeat_at=_now(),
                progress=1,
            )
            if task.agent_role == "synthesis_agent":
                await self.store.append_event(
                    run.swarm_run_id, "synthesis_started", task_id=task.task_id
                )
                synthesis = synthesize(
                    await self.store.tasks_internal(run.swarm_run_id),
                    await self.store.outputs_internal(run.swarm_run_id),
                )
                reject_hidden_reasoning_fields(synthesis.model_dump(mode="json"))
                usage = SwarmUsage(
                    token_count=max(1, len(json.dumps(synthesis.model_dump(mode="json"))) // 4)
                )
                await self._complete_with_budget(run, task, synthesis, usage)
                return
            outputs = await self.store.outputs_internal(run.swarm_run_id)
            upstream = {
                dependency: bounded_upstream_output(outputs[dependency])
                for dependency in task.dependencies
                if dependency in outputs
            }
            async with asyncio.timeout(task.timeout_seconds):
                result = await self.worker.run(
                    TaskExecutionContext(
                        run=run,
                        task=task,
                        upstream=upstream,
                        cancelled=task_event,
                        heartbeat=lambda: self.store.heartbeat(run.swarm_run_id, task.task_id),
                    )
                )
            validate_output(result.output, run.user_id)
            if task_event.is_set() or self.run_cancels[run.swarm_run_id].is_set():
                raise JobCancelled
            await self._complete_with_budget(run, task, result.output, result.usage)
        except JobCancelled:
            await self._transition_running_task(
                run.swarm_run_id,
                task.task_id,
                SwarmTaskStatus.CANCELLED,
                "task_cancelled",
                "SWARM_TASK_CANCELLED",
            )
        except TimeoutError:
            await self._transition_running_task(
                run.swarm_run_id,
                task.task_id,
                SwarmTaskStatus.TIMED_OUT,
                "task_failed",
                "SWARM_TASK_TIMEOUT",
            )
        except WorkerFailure as exc:
            current = await self._current_task(run.swarm_run_id, task.task_id)
            if exc.retryable and current.retryable and current.attempt < current.max_attempts:
                await self.store.transition_task(
                    run.swarm_run_id,
                    task.task_id,
                    SwarmTaskStatus.RETRY_WAIT,
                    "task_retried",
                    error_code=exc.code,
                )
                try:
                    cancelled = await asyncio.wait_for(
                        task_event.wait(), timeout=0.05 * current.attempt
                    )
                    if cancelled:
                        await self.store.transition_task(
                            run.swarm_run_id,
                            task.task_id,
                            SwarmTaskStatus.CANCELLED,
                            "task_cancelled",
                            completed_at=_now(),
                            error_code="SWARM_TASK_CANCELLED",
                        )
                except TimeoutError:
                    await self.store.transition_task(
                        run.swarm_run_id,
                        task.task_id,
                        SwarmTaskStatus.READY,
                        "task_ready",
                        error_code=None,
                    )
            else:
                await self._transition_running_task(
                    run.swarm_run_id,
                    task.task_id,
                    SwarmTaskStatus.FAILED,
                    "task_failed",
                    exc.code,
                )
        except asyncio.CancelledError:
            stale = (run.swarm_run_id, task.task_id) in self.stale_tasks
            await self._transition_running_task(
                run.swarm_run_id,
                task.task_id,
                SwarmTaskStatus.FAILED if stale else SwarmTaskStatus.CANCELLED,
                "task_failed" if stale else "task_cancelled",
                "SWARM_HEARTBEAT_MISSED" if stale else "SWARM_TASK_CANCELLED",
            )
            raise
        except ServiceError as exc:
            await self._transition_running_task(
                run.swarm_run_id,
                task.task_id,
                SwarmTaskStatus.FAILED,
                "task_failed",
                exc.code,
            )
        except Exception:
            await self._transition_running_task(
                run.swarm_run_id,
                task.task_id,
                SwarmTaskStatus.FAILED,
                "task_failed",
                "SWARM_WORKER_FAILED",
            )

    async def _complete_with_budget(
        self,
        run: SwarmRun,
        task: SwarmTask,
        output: GroundedTaskOutput | FinalSynthesis,
        usage: SwarmUsage,
    ) -> None:
        lock = self.budget_locks.setdefault(run.swarm_run_id, asyncio.Lock())
        async with lock:
            total = await self.store.usage_total(run.swarm_run_id)
            role = ROLE_POLICIES[task.agent_role]
            role_fits = (
                usage.token_count <= role.token_budget and usage.tool_calls <= role.tool_call_budget
            )
            remaining = (
                run.token_budget - total.token_count,
                run.cost_budget - total.cost,
                run.tool_call_budget - total.tool_calls,
            )
            if not role_fits or not usage_fits(*remaining, usage):
                await self.store.append_event(
                    run.swarm_run_id,
                    "budget_exhausted",
                    task_id=task.task_id,
                    metadata={"reason": "run usage budget"},
                )
                self.budget_stops.add(run.swarm_run_id)
                await self._transition_running_task(
                    run.swarm_run_id,
                    task.task_id,
                    SwarmTaskStatus.FAILED,
                    "task_failed",
                    "SWARM_BUDGET_EXHAUSTED",
                )
                return
            await self.store.complete_task(run.swarm_run_id, task.task_id, output, usage)

    async def _detect_stale(self, run_id: str, active: dict[str, asyncio.Task[None]]) -> None:
        now = _now()
        tasks = {task.task_id: task for task in await self.store.tasks_internal(run_id)}
        for task_id, future in active.items():
            task = tasks[task_id]
            if (
                task.status is SwarmTaskStatus.RUNNING
                and task.heartbeat_at is not None
                and (now - task.heartbeat_at).total_seconds() > self.settings.swarm_stale_seconds
            ):
                self.stale_tasks.add((run_id, task_id))
                await self.store.append_event(
                    run_id,
                    "heartbeat_missed",
                    task_id=task_id,
                    metadata={"stale_seconds": self.settings.swarm_stale_seconds},
                )
                future.cancel()

    async def _finalize_success(self, run_id: str) -> None:
        synthesis = await self.store.synthesis_internal(run_id)
        if synthesis is None or synthesis.completion_status == "failed":
            await self.store.transition_run(
                run_id,
                SwarmRunStatus.FAILED,
                "run_failed",
                completed_at=_now(),
                error_code="SWARM_SYNTHESIS_UNAVAILABLE",
            )
            return
        await self._write_final_artifacts(run_id, synthesis)
        target = (
            SwarmRunStatus.PARTIALLY_COMPLETED
            if synthesis.completion_status == "partially_completed"
            else SwarmRunStatus.SUCCEEDED
        )
        await self.store.transition_run(
            run_id,
            target,
            "run_partially_completed"
            if target is SwarmRunStatus.PARTIALLY_COMPLETED
            else "run_completed",
            completed_at=_now(),
            result_summary=synthesis.executive_summary,
        )

    async def _write_initial_artifacts(self, run: SwarmRun) -> None:
        tasks = await self.store.tasks_internal(run.swarm_run_id)
        plan = {
            "schema_version": "research-swarm-plan-v1",
            "run_id": run.swarm_run_id,
            "preset": run.preset,
            "title": run.title,
            "objective": run.objective,
            "research_only": True,
            "execution_prohibited": True,
        }
        graph = {
            "schema_version": "research-swarm-graph-v1",
            "tasks": [
                {
                    "task_id": task.task_id,
                    "agent_role": task.agent_role,
                    "dependencies": task.dependencies,
                    "required": task.required,
                }
                for task in tasks
            ],
        }
        await self._write_json_artifact(run, "swarm_plan.json", plan)
        await self._write_json_artifact(run, "task_graph.json", graph)

    async def _write_final_artifacts(self, run_id: str, synthesis: FinalSynthesis) -> None:
        run = await self.store.get_internal(run_id)
        assert run is not None
        outputs = await self.store.outputs_internal(run_id)
        usage = await self.store.usage_total(run_id)
        events = await self.store.events_for_user(run_id, run.user_id) or []
        artifacts: list[tuple[str, Any]] = [
            (
                "task_results.json",
                {key: value.model_dump(mode="json") for key, value in outputs.items()},
            ),
            ("final_synthesis.json", synthesis.model_dump(mode="json")),
            (
                "evidence_index.json",
                [item.model_dump(mode="json") for item in synthesis.evidence_refs],
            ),
            ("limitations.json", synthesis.limitations),
            ("cost_usage.json", usage.model_dump(mode="json")),
            ("progress_timeline.json", [event.model_dump(mode="json") for event in events]),
        ]
        for name, payload in artifacts:
            await self._write_json_artifact(run, name, payload)

    async def _write_json_artifact(
        self, run: SwarmRun, name: str, payload: Any
    ) -> ArtifactReference:
        reject_hidden_reasoning_fields(payload)
        content = json.dumps(
            payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
        lock = self.artifact_locks.setdefault(run.swarm_run_id, asyncio.Lock())
        async with lock:
            current = await self.store.get_internal(run.swarm_run_id)
            if current is None or current.status in RUN_TERMINAL_STATES | {
                SwarmRunStatus.CANCELLING
            }:
                raise ServiceError("SWARM_STATE_INVALID", "run cannot write artifacts", 409)
            count = len(current.artifact_refs)
            total = sum(item.size_bytes for item in current.artifact_refs)
            if (
                count >= current.artifact_count_budget
                or total + len(content) > current.artifact_bytes_budget
            ):
                await self.store.append_event(
                    run.swarm_run_id,
                    "budget_exhausted",
                    metadata={"reason": "artifact budget"},
                )
                raise ServiceError("SWARM_BUDGET_EXHAUSTED", "artifact budget exhausted", 413)
            reference = await self.artifacts.write(
                run.user_id, run.swarm_run_id, "json", name, content
            )
            await self.store.attach_artifact(run.swarm_run_id, reference)
            return reference

    async def _transition_running_task(
        self,
        run_id: str,
        task_id: str,
        status: SwarmTaskStatus,
        event_type: str,
        error_code: str,
    ) -> None:
        current = await self._current_task(run_id, task_id)
        if current.status is SwarmTaskStatus.RUNNING:
            await self.store.transition_task(
                run_id,
                task_id,
                status,
                event_type,
                completed_at=_now(),
                error_code=error_code,
            )

    async def _current_task(self, run_id: str, task_id: str) -> SwarmTask:
        tasks = await self.store.tasks_internal(run_id)
        return next(task for task in tasks if task.task_id == task_id)

    async def _cancel_remaining_tasks(self, run_id: str) -> None:
        for task in await self.store.tasks_internal(run_id):
            if task.status not in TASK_TERMINAL_STATES:
                if task.status is SwarmTaskStatus.RUNNING:
                    self.task_cancels.setdefault((run_id, task.task_id), asyncio.Event()).set()
                else:
                    await self.store.transition_task(
                        run_id,
                        task.task_id,
                        SwarmTaskStatus.CANCELLED,
                        "task_cancelled",
                        completed_at=_now(),
                        error_code="SWARM_CANCELLED",
                    )

    async def _terminalize_tasks(
        self, run_id: str, running_status: SwarmTaskStatus, error_code: str
    ) -> None:
        for task in await self.store.tasks_internal(run_id):
            if task.status in TASK_TERMINAL_STATES:
                continue
            target = (
                running_status
                if task.status is SwarmTaskStatus.RUNNING
                else SwarmTaskStatus.SKIPPED
            )
            await self.store.transition_task(
                run_id,
                task.task_id,
                target,
                "task_failed",
                completed_at=_now(),
                error_code=error_code,
            )

    async def _skip_unstarted(self, run_id: str, error_code: str) -> None:
        for task in await self.store.tasks_internal(run_id):
            if (
                task.status not in TASK_TERMINAL_STATES
                and task.status is not SwarmTaskStatus.RUNNING
            ):
                await self.store.transition_task(
                    run_id,
                    task.task_id,
                    SwarmTaskStatus.SKIPPED,
                    "task_failed",
                    completed_at=_now(),
                    error_code=error_code,
                )
