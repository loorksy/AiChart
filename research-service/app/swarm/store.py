from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
from collections.abc import Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.core.ids import opaque_id
from app.core.redaction import bounded_metadata, redact_text
from app.errors import ServiceError
from app.models.jobs import ArtifactReference
from app.swarm.models import (
    RUN_TERMINAL_STATES,
    EvidenceReference,
    FinalSynthesis,
    GroundedTaskOutput,
    SwarmBudgets,
    SwarmCreateRequest,
    SwarmEvent,
    SwarmRun,
    SwarmRunStatus,
    SwarmTask,
    SwarmTaskStatus,
    SwarmUsage,
)

_RUN_TRANSITIONS: dict[SwarmRunStatus, set[SwarmRunStatus]] = {
    SwarmRunStatus.DRAFT: {SwarmRunStatus.QUEUED, SwarmRunStatus.CANCELLED},
    SwarmRunStatus.QUEUED: {
        SwarmRunStatus.RUNNING,
        SwarmRunStatus.CANCELLING,
        SwarmRunStatus.CANCELLED,
        SwarmRunStatus.FAILED,
    },
    SwarmRunStatus.RUNNING: {
        SwarmRunStatus.CANCELLING,
        SwarmRunStatus.CANCELLED,
        SwarmRunStatus.PARTIALLY_COMPLETED,
        SwarmRunStatus.SUCCEEDED,
        SwarmRunStatus.FAILED,
        SwarmRunStatus.TIMED_OUT,
    },
    SwarmRunStatus.CANCELLING: {SwarmRunStatus.CANCELLED, SwarmRunStatus.FAILED},
    SwarmRunStatus.CANCELLED: set(),
    SwarmRunStatus.PARTIALLY_COMPLETED: set(),
    SwarmRunStatus.SUCCEEDED: set(),
    SwarmRunStatus.FAILED: set(),
    SwarmRunStatus.TIMED_OUT: set(),
}
_TASK_TRANSITIONS: dict[SwarmTaskStatus, set[SwarmTaskStatus]] = {
    SwarmTaskStatus.PENDING: {
        SwarmTaskStatus.BLOCKED,
        SwarmTaskStatus.READY,
        SwarmTaskStatus.CANCELLED,
        SwarmTaskStatus.SKIPPED,
    },
    SwarmTaskStatus.BLOCKED: {
        SwarmTaskStatus.READY,
        SwarmTaskStatus.CANCELLED,
        SwarmTaskStatus.SKIPPED,
    },
    SwarmTaskStatus.READY: {
        SwarmTaskStatus.RUNNING,
        SwarmTaskStatus.CANCELLED,
        SwarmTaskStatus.SKIPPED,
    },
    SwarmTaskStatus.RUNNING: {
        SwarmTaskStatus.RETRY_WAIT,
        SwarmTaskStatus.SUCCEEDED,
        SwarmTaskStatus.FAILED,
        SwarmTaskStatus.CANCELLED,
        SwarmTaskStatus.TIMED_OUT,
    },
    SwarmTaskStatus.RETRY_WAIT: {
        SwarmTaskStatus.READY,
        SwarmTaskStatus.CANCELLED,
        SwarmTaskStatus.SKIPPED,
    },
    SwarmTaskStatus.SUCCEEDED: set(),
    SwarmTaskStatus.FAILED: set(),
    SwarmTaskStatus.CANCELLED: set(),
    SwarmTaskStatus.SKIPPED: set(),
    SwarmTaskStatus.TIMED_OUT: set(),
}


def _now() -> datetime:
    return datetime.now(UTC)


def _json(value: Any) -> str:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _loads(value: str | None, fallback: Any) -> Any:
    return json.loads(value) if value else fallback


class SwarmStore:
    """Least-privilege durable SQLite state with append-only transition events."""

    def __init__(self, path: Path, *, max_events: int) -> None:
        self.path = path.resolve()
        self.max_events = max_events
        self._lock = asyncio.Lock()

    @contextmanager
    def _connect(self) -> Any:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    async def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        async with self._lock:
            with self._connect() as connection:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS research_swarm_runs (
                      swarm_run_id TEXT PRIMARY KEY,
                      user_id INTEGER NOT NULL,
                      request_id TEXT NOT NULL,
                      idempotency_key TEXT NOT NULL,
                      fingerprint TEXT NOT NULL,
                      preset TEXT NOT NULL,
                      title TEXT NOT NULL,
                      objective TEXT NOT NULL,
                      status TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      queued_at TEXT NOT NULL,
                      started_at TEXT,
                      completed_at TEXT,
                      cancelled_at TEXT,
                      timeout_seconds INTEGER NOT NULL,
                      max_attempts INTEGER NOT NULL,
                      token_budget INTEGER NOT NULL,
                      cost_budget REAL NOT NULL,
                      tool_call_budget INTEGER NOT NULL,
                      max_workers INTEGER NOT NULL,
                      max_tasks INTEGER NOT NULL,
                      max_depth INTEGER NOT NULL,
                      task_timeout_seconds INTEGER NOT NULL,
                      artifact_count_budget INTEGER NOT NULL,
                      artifact_bytes_budget INTEGER NOT NULL,
                      progress_event_count_budget INTEGER NOT NULL,
                      result_summary TEXT,
                      error_code TEXT,
                      warnings_json TEXT NOT NULL,
                      artifact_refs_json TEXT NOT NULL,
                      evidence_refs_json TEXT NOT NULL,
                      parameters_json TEXT NOT NULL,
                      UNIQUE(user_id, idempotency_key)
                    );
                    CREATE TABLE IF NOT EXISTS research_swarm_tasks (
                      swarm_run_id TEXT NOT NULL,
                      task_id TEXT NOT NULL,
                      agent_role TEXT NOT NULL,
                      title TEXT NOT NULL,
                      objective TEXT NOT NULL,
                      dependencies_json TEXT NOT NULL,
                      status TEXT NOT NULL,
                      attempt INTEGER NOT NULL,
                      max_attempts INTEGER NOT NULL,
                      timeout_seconds INTEGER NOT NULL,
                      required_skills_json TEXT NOT NULL,
                      allowed_tools_json TEXT NOT NULL,
                      input_refs_json TEXT NOT NULL,
                      output_refs_json TEXT NOT NULL,
                      progress INTEGER NOT NULL,
                      heartbeat_at TEXT,
                      started_at TEXT,
                      completed_at TEXT,
                      error_code TEXT,
                      required INTEGER NOT NULL,
                      retryable INTEGER NOT NULL,
                      PRIMARY KEY(swarm_run_id, task_id),
                      FOREIGN KEY(swarm_run_id) REFERENCES research_swarm_runs(swarm_run_id)
                        ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS research_swarm_dependencies (
                      swarm_run_id TEXT NOT NULL,
                      task_id TEXT NOT NULL,
                      dependency_task_id TEXT NOT NULL,
                      PRIMARY KEY(swarm_run_id, task_id, dependency_task_id),
                      FOREIGN KEY(swarm_run_id, task_id)
                        REFERENCES research_swarm_tasks(swarm_run_id, task_id) ON DELETE CASCADE,
                      FOREIGN KEY(swarm_run_id, dependency_task_id)
                        REFERENCES research_swarm_tasks(swarm_run_id, task_id) ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS research_swarm_events (
                      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                      swarm_run_id TEXT NOT NULL,
                      user_id INTEGER NOT NULL,
                      event_type TEXT NOT NULL,
                      task_id TEXT,
                      timestamp TEXT NOT NULL,
                      metadata_json TEXT NOT NULL,
                      FOREIGN KEY(swarm_run_id) REFERENCES research_swarm_runs(swarm_run_id)
                        ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS research_swarm_outputs (
                      output_id TEXT PRIMARY KEY,
                      swarm_run_id TEXT NOT NULL,
                      task_id TEXT NOT NULL,
                      schema_version TEXT NOT NULL,
                      output_json TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      UNIQUE(swarm_run_id, task_id),
                      FOREIGN KEY(swarm_run_id, task_id)
                        REFERENCES research_swarm_tasks(swarm_run_id, task_id) ON DELETE CASCADE
                    );
                    CREATE TABLE IF NOT EXISTS research_swarm_usage (
                      usage_id TEXT PRIMARY KEY,
                      swarm_run_id TEXT NOT NULL,
                      task_id TEXT,
                      token_count INTEGER NOT NULL,
                      cost REAL NOT NULL,
                      tool_calls INTEGER NOT NULL,
                      created_at TEXT NOT NULL,
                      FOREIGN KEY(swarm_run_id) REFERENCES research_swarm_runs(swarm_run_id)
                        ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_swarm_runs_user_created
                      ON research_swarm_runs(user_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_swarm_events_run_sequence
                      ON research_swarm_events(swarm_run_id, sequence);
                    CREATE INDEX IF NOT EXISTS idx_swarm_tasks_run_status
                      ON research_swarm_tasks(swarm_run_id, status);
                    """
                )

    async def available(self) -> bool:
        try:
            async with self._lock:
                with self._connect() as connection:
                    return connection.execute("SELECT 1").fetchone() is not None
        except sqlite3.Error:
            return False

    @staticmethod
    def _fingerprint(request: SwarmCreateRequest) -> str:
        payload = request.model_dump(mode="json", exclude={"idempotency_key"})
        return hashlib.sha256(_json(payload).encode()).hexdigest()

    async def create_or_get(
        self,
        request: SwarmCreateRequest,
        *,
        user_id: int,
        request_id: str,
        budgets: SwarmBudgets,
        tasks: list[SwarmTask],
        parameters: dict[str, Any],
        max_attempts: int,
        timeout_seconds: int,
    ) -> tuple[SwarmRun, bool]:
        fingerprint = self._fingerprint(request)
        async with self._lock:
            with self._connect() as connection:
                existing = connection.execute(
                    "SELECT * FROM research_swarm_runs WHERE user_id=? AND idempotency_key=?",
                    (user_id, request.idempotency_key),
                ).fetchone()
                if existing:
                    if existing["fingerprint"] != fingerprint:
                        raise ServiceError(
                            "SWARM_IDEMPOTENCY_CONFLICT",
                            "idempotency key has a conflicting request",
                            409,
                        )
                    return self._run_from_row(existing), False
                run_id = tasks[0].swarm_run_id
                now = _now()
                connection.execute(
                    """INSERT INTO research_swarm_runs
                    (swarm_run_id,user_id,request_id,idempotency_key,fingerprint,preset,title,
                     objective,status,created_at,queued_at,timeout_seconds,max_attempts,token_budget,
                     cost_budget,tool_call_budget,max_workers,max_tasks,max_depth,
                     task_timeout_seconds,artifact_count_budget,artifact_bytes_budget,
                     progress_event_count_budget,warnings_json,artifact_refs_json,
                     evidence_refs_json,parameters_json)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        run_id,
                        user_id,
                        request_id,
                        request.idempotency_key,
                        fingerprint,
                        request.preset,
                        request.title,
                        request.objective,
                        SwarmRunStatus.QUEUED.value,
                        now.isoformat(),
                        now.isoformat(),
                        timeout_seconds,
                        max_attempts,
                        budgets.token_budget,
                        budgets.cost_budget,
                        budgets.tool_call_budget,
                        budgets.max_workers,
                        budgets.max_tasks,
                        budgets.max_depth,
                        budgets.task_timeout_seconds,
                        budgets.artifact_count,
                        budgets.artifact_bytes,
                        budgets.progress_event_count,
                        "[]",
                        "[]",
                        _json(request.evidence_refs),
                        _json(parameters),
                    ),
                )
                for task in tasks:
                    self._insert_task(connection, task)
                for task in tasks:
                    for dependency in task.dependencies:
                        connection.execute(
                            "INSERT INTO research_swarm_dependencies VALUES (?,?,?)",
                            (run_id, task.task_id, dependency),
                        )
                self._insert_event(
                    connection,
                    run_id,
                    user_id,
                    "run_created",
                    metadata={"preset": request.preset, "task_count": len(tasks)},
                )
                self._insert_event(
                    connection,
                    run_id,
                    user_id,
                    "dag_validated",
                    metadata={"task_count": len(tasks)},
                )
                row = connection.execute(
                    "SELECT * FROM research_swarm_runs WHERE swarm_run_id=?", (run_id,)
                ).fetchone()
                assert row is not None
                return self._run_from_row(row), True

    def _insert_task(self, connection: sqlite3.Connection, task: SwarmTask) -> None:
        connection.execute(
            """INSERT INTO research_swarm_tasks
            (swarm_run_id,task_id,agent_role,title,objective,dependencies_json,status,attempt,
             max_attempts,timeout_seconds,required_skills_json,allowed_tools_json,input_refs_json,
             output_refs_json,progress,heartbeat_at,started_at,completed_at,error_code,required,retryable)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                task.swarm_run_id,
                task.task_id,
                task.agent_role,
                task.title,
                task.objective,
                _json(task.dependencies),
                task.status.value,
                task.attempt,
                task.max_attempts,
                task.timeout_seconds,
                _json(task.required_skills),
                _json(task.allowed_tools),
                _json(task.input_refs),
                _json(task.output_refs),
                task.progress,
                task.heartbeat_at.isoformat() if task.heartbeat_at else None,
                task.started_at.isoformat() if task.started_at else None,
                task.completed_at.isoformat() if task.completed_at else None,
                task.error_code,
                int(task.required),
                int(task.retryable),
            ),
        )

    def _insert_event(
        self,
        connection: sqlite3.Connection,
        run_id: str,
        user_id: int,
        event_type: str,
        *,
        task_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
        enforce_budget: bool = False,
    ) -> None:
        if enforce_budget:
            budget_row = connection.execute(
                """SELECT progress_event_count_budget FROM research_swarm_runs
                WHERE swarm_run_id=?""",
                (run_id,),
            ).fetchone()
            maximum = min(
                self.max_events,
                int(budget_row["progress_event_count_budget"]) if budget_row else self.max_events,
            )
            count = connection.execute(
                "SELECT COUNT(*) FROM research_swarm_events WHERE swarm_run_id=?", (run_id,)
            ).fetchone()[0]
            if count >= maximum:
                raise ServiceError("SWARM_BUDGET_EXHAUSTED", "progress event budget exhausted", 409)
        safe_metadata = bounded_metadata(metadata or {}, 2_048)
        connection.execute(
            """INSERT INTO research_swarm_events
            (swarm_run_id,user_id,event_type,task_id,timestamp,metadata_json)
            VALUES (?,?,?,?,?,?)""",
            (run_id, user_id, event_type[:80], task_id, _now().isoformat(), _json(safe_metadata)),
        )

    async def get_for_user(self, run_id: str, user_id: int) -> SwarmRun | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM research_swarm_runs WHERE swarm_run_id=? AND user_id=?",
                    (run_id, user_id),
                ).fetchone()
                return self._run_from_row(row) if row else None

    async def get_internal(self, run_id: str) -> SwarmRun | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM research_swarm_runs WHERE swarm_run_id=?", (run_id,)
                ).fetchone()
                return self._run_from_row(row) if row else None

    async def tasks_for_user(self, run_id: str, user_id: int) -> list[SwarmTask] | None:
        if await self.get_for_user(run_id, user_id) is None:
            return None
        return await self.tasks_internal(run_id)

    async def tasks_internal(self, run_id: str) -> list[SwarmTask]:
        async with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    "SELECT * FROM research_swarm_tasks WHERE swarm_run_id=? ORDER BY task_id",
                    (run_id,),
                ).fetchall()
                return [self._task_from_row(row) for row in rows]

    async def events_for_user(self, run_id: str, user_id: int) -> list[SwarmEvent] | None:
        if await self.get_for_user(run_id, user_id) is None:
            return None
        async with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    "SELECT * FROM research_swarm_events WHERE swarm_run_id=? ORDER BY sequence",
                    (run_id,),
                ).fetchall()
                return [self._event_from_row(row) for row in rows]

    async def append_event(
        self,
        run_id: str,
        event_type: str,
        *,
        task_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT user_id FROM research_swarm_runs WHERE swarm_run_id=?", (run_id,)
                ).fetchone()
                if row is None:
                    raise ServiceError("SWARM_NOT_FOUND", "research swarm run not found", 404)
                self._insert_event(
                    connection,
                    run_id,
                    int(row["user_id"]),
                    event_type,
                    task_id=task_id,
                    metadata=metadata,
                    enforce_budget=True,
                )

    async def transition_run(
        self,
        run_id: str,
        status: SwarmRunStatus,
        event_type: str,
        **updates: Any,
    ) -> SwarmRun:
        allowed_updates = {
            "started_at",
            "completed_at",
            "cancelled_at",
            "result_summary",
            "error_code",
            "warnings_json",
        }
        if not set(updates) <= allowed_updates:
            raise ServiceError("SWARM_STATE_INVALID", "unsupported run state update", 500)
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM research_swarm_runs WHERE swarm_run_id=?", (run_id,)
                ).fetchone()
                if row is None:
                    raise ServiceError("SWARM_NOT_FOUND", "research swarm run not found", 404)
                current = SwarmRunStatus(row["status"])
                if status != current and status not in _RUN_TRANSITIONS[current]:
                    raise ServiceError("SWARM_STATE_INVALID", "illegal swarm run transition", 409)
                values: list[Any] = [status.value]
                assignments = ["status=?"]
                for key, value in updates.items():
                    if isinstance(value, datetime):
                        value = value.isoformat()
                    if key == "result_summary" and isinstance(value, str):
                        value = redact_text(value, 4_000)
                    assignments.append(f"{key}=?")
                    values.append(value)
                values.append(run_id)
                connection.execute(
                    # Column names come only from the closed allowlist above.
                    f"UPDATE research_swarm_runs SET {','.join(assignments)} "  # noqa: S608
                    "WHERE swarm_run_id=?",
                    values,
                )
                self._insert_event(
                    connection,
                    run_id,
                    int(row["user_id"]),
                    event_type,
                    metadata={"from": current.value, "to": status.value},
                )
                updated = connection.execute(
                    "SELECT * FROM research_swarm_runs WHERE swarm_run_id=?", (run_id,)
                ).fetchone()
                assert updated is not None
                return self._run_from_row(updated)

    async def transition_task(
        self,
        run_id: str,
        task_id: str,
        status: SwarmTaskStatus,
        event_type: str,
        **updates: Any,
    ) -> SwarmTask:
        allowed_updates = {
            "attempt",
            "progress",
            "heartbeat_at",
            "started_at",
            "completed_at",
            "error_code",
            "input_refs_json",
            "output_refs_json",
        }
        if not set(updates) <= allowed_updates:
            raise ServiceError("SWARM_STATE_INVALID", "unsupported task state update", 500)
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM research_swarm_tasks WHERE swarm_run_id=? AND task_id=?",
                    (run_id, task_id),
                ).fetchone()
                if row is None:
                    raise ServiceError("SWARM_TASK_NOT_FOUND", "research swarm task not found", 404)
                current = SwarmTaskStatus(row["status"])
                if status != current and status not in _TASK_TRANSITIONS[current]:
                    raise ServiceError("SWARM_STATE_INVALID", "illegal swarm task transition", 409)
                values: list[Any] = [status.value]
                assignments = ["status=?"]
                for key, value in updates.items():
                    if isinstance(value, datetime):
                        value = value.isoformat()
                    assignments.append(f"{key}=?")
                    values.append(value)
                values.extend((run_id, task_id))
                connection.execute(
                    # Column names come only from the closed allowlist above.
                    f"UPDATE research_swarm_tasks SET {','.join(assignments)} "  # noqa: S608
                    "WHERE swarm_run_id=? AND task_id=?",
                    values,
                )
                owner = connection.execute(
                    "SELECT user_id FROM research_swarm_runs WHERE swarm_run_id=?", (run_id,)
                ).fetchone()
                assert owner is not None
                self._insert_event(
                    connection,
                    run_id,
                    int(owner["user_id"]),
                    event_type,
                    task_id=task_id,
                    metadata={"from": current.value, "to": status.value},
                )
                updated = connection.execute(
                    "SELECT * FROM research_swarm_tasks WHERE swarm_run_id=? AND task_id=?",
                    (run_id, task_id),
                ).fetchone()
                assert updated is not None
                return self._task_from_row(updated)

    async def heartbeat(self, run_id: str, task_id: str) -> None:
        async with self._lock:
            with self._connect() as connection:
                connection.execute(
                    """UPDATE research_swarm_tasks SET heartbeat_at=?
                    WHERE swarm_run_id=? AND task_id=? AND status=?""",
                    (_now().isoformat(), run_id, task_id, SwarmTaskStatus.RUNNING.value),
                )

    async def complete_task(
        self,
        run_id: str,
        task_id: str,
        output: GroundedTaskOutput | FinalSynthesis,
        usage: SwarmUsage,
    ) -> SwarmTask:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM research_swarm_tasks WHERE swarm_run_id=? AND task_id=?",
                    (run_id, task_id),
                ).fetchone()
                if row is None or SwarmTaskStatus(row["status"]) is not SwarmTaskStatus.RUNNING:
                    raise ServiceError("SWARM_STATE_INVALID", "task is not running", 409)
                now = _now()
                connection.execute(
                    """INSERT INTO research_swarm_outputs
                    (output_id,swarm_run_id,task_id,schema_version,output_json,created_at)
                    VALUES (?,?,?,?,?,?)""",
                    (
                        opaque_id("swo"),
                        run_id,
                        task_id,
                        output.schema_version,
                        _json(output),
                        now.isoformat(),
                    ),
                )
                connection.execute(
                    """INSERT INTO research_swarm_usage
                    (usage_id,swarm_run_id,task_id,token_count,cost,tool_calls,created_at)
                    VALUES (?,?,?,?,?,?,?)""",
                    (
                        opaque_id("swu"),
                        run_id,
                        task_id,
                        usage.token_count,
                        usage.cost,
                        usage.tool_calls,
                        now.isoformat(),
                    ),
                )
                connection.execute(
                    """UPDATE research_swarm_tasks
                    SET status=?,progress=100,completed_at=?,heartbeat_at=?,output_refs_json=?
                    WHERE swarm_run_id=? AND task_id=?""",
                    (
                        SwarmTaskStatus.SUCCEEDED.value,
                        now.isoformat(),
                        now.isoformat(),
                        _json([task_id]),
                        run_id,
                        task_id,
                    ),
                )
                owner = connection.execute(
                    "SELECT user_id FROM research_swarm_runs WHERE swarm_run_id=?", (run_id,)
                ).fetchone()
                assert owner is not None
                event = (
                    "synthesis_completed"
                    if output.schema_version.endswith("synthesis-v1")
                    else "task_completed"
                )
                self._insert_event(
                    connection,
                    run_id,
                    int(owner["user_id"]),
                    event,
                    task_id=task_id,
                    metadata={"schema_version": output.schema_version},
                )
                updated = connection.execute(
                    "SELECT * FROM research_swarm_tasks WHERE swarm_run_id=? AND task_id=?",
                    (run_id, task_id),
                ).fetchone()
                assert updated is not None
                return self._task_from_row(updated)

    async def outputs_internal(self, run_id: str) -> dict[str, GroundedTaskOutput]:
        async with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    """SELECT task_id,output_json FROM research_swarm_outputs
                    WHERE swarm_run_id=? AND schema_version='grounded-task-output-v1'
                    ORDER BY task_id""",
                    (run_id,),
                ).fetchall()
                return {
                    str(row["task_id"]): GroundedTaskOutput.model_validate_json(row["output_json"])
                    for row in rows
                }

    async def synthesis_internal(self, run_id: str) -> FinalSynthesis | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    """SELECT output_json FROM research_swarm_outputs
                    WHERE swarm_run_id=? AND schema_version='research-swarm-synthesis-v1'
                    ORDER BY created_at DESC LIMIT 1""",
                    (run_id,),
                ).fetchone()
                return FinalSynthesis.model_validate_json(row["output_json"]) if row else None

    async def usage_total(self, run_id: str) -> SwarmUsage:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    """SELECT COALESCE(SUM(token_count),0) AS tokens,
                    COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(tool_calls),0) AS tools
                    FROM research_swarm_usage WHERE swarm_run_id=?""",
                    (run_id,),
                ).fetchone()
                assert row is not None
                return SwarmUsage(
                    token_count=int(row["tokens"]),
                    cost=float(row["cost"]),
                    tool_calls=int(row["tools"]),
                )

    async def attach_artifact(self, run_id: str, artifact: ArtifactReference) -> None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    """SELECT user_id,status,artifact_refs_json
                    FROM research_swarm_runs WHERE swarm_run_id=?""",
                    (run_id,),
                ).fetchone()
                if row is None or int(row["user_id"]) != artifact.user_id:
                    raise ServiceError("SWARM_NOT_FOUND", "research swarm run not found", 404)
                if SwarmRunStatus(row["status"]) in RUN_TERMINAL_STATES:
                    raise ServiceError(
                        "SWARM_STATE_INVALID", "terminal run cannot add artifacts", 409
                    )
                artifacts = _loads(row["artifact_refs_json"], [])
                artifacts.append(artifact.model_dump(mode="json"))
                connection.execute(
                    "UPDATE research_swarm_runs SET artifact_refs_json=? WHERE swarm_run_id=?",
                    (_json(artifacts), run_id),
                )
                self._insert_event(
                    connection,
                    run_id,
                    artifact.user_id,
                    "artifact_created",
                    metadata={"artifact_id": artifact.artifact_id, "name": artifact.name},
                )

    async def request_cancel(self, run_id: str, user_id: int) -> SwarmRun | None:
        run = await self.get_for_user(run_id, user_id)
        if run is None or run.status in RUN_TERMINAL_STATES:
            return run
        now = _now()
        if run.status is SwarmRunStatus.QUEUED:
            return await self.transition_run(
                run_id,
                SwarmRunStatus.CANCELLED,
                "run_cancelled",
                completed_at=now,
                cancelled_at=now,
                error_code="SWARM_CANCELLED",
            )
        if run.status is not SwarmRunStatus.CANCELLING:
            return await self.transition_run(run_id, SwarmRunStatus.CANCELLING, "run_cancelling")
        return run

    async def queued_run_ids(self) -> list[str]:
        async with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    """SELECT swarm_run_id FROM research_swarm_runs
                    WHERE status=? ORDER BY queued_at""",
                    (SwarmRunStatus.QUEUED.value,),
                ).fetchall()
                return [str(row["swarm_run_id"]) for row in rows]

    async def recover_abandoned(self) -> None:
        async with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    """SELECT swarm_run_id,user_id,status FROM research_swarm_runs
                    WHERE status IN (?,?)""",
                    (SwarmRunStatus.RUNNING.value, SwarmRunStatus.CANCELLING.value),
                ).fetchall()
                now = _now().isoformat()
                for row in rows:
                    run_id = str(row["swarm_run_id"])
                    target = (
                        SwarmRunStatus.CANCELLED
                        if row["status"] == SwarmRunStatus.CANCELLING.value
                        else SwarmRunStatus.FAILED
                    )
                    connection.execute(
                        """UPDATE research_swarm_runs
                        SET status=?,completed_at=?,cancelled_at=?,error_code=?
                        WHERE swarm_run_id=?""",
                        (
                            target.value,
                            now,
                            now if target is SwarmRunStatus.CANCELLED else None,
                            "SWARM_SERVICE_RESTARTED",
                            run_id,
                        ),
                    )
                    connection.execute(
                        """UPDATE research_swarm_tasks SET status=?,completed_at=?,error_code=?
                        WHERE swarm_run_id=? AND status NOT IN (?,?,?,?,?)""",
                        (
                            SwarmTaskStatus.CANCELLED.value
                            if target is SwarmRunStatus.CANCELLED
                            else SwarmTaskStatus.FAILED.value,
                            now,
                            "SWARM_SERVICE_RESTARTED",
                            run_id,
                            SwarmTaskStatus.SUCCEEDED.value,
                            SwarmTaskStatus.FAILED.value,
                            SwarmTaskStatus.CANCELLED.value,
                            SwarmTaskStatus.SKIPPED.value,
                            SwarmTaskStatus.TIMED_OUT.value,
                        ),
                    )
                    self._insert_event(
                        connection,
                        run_id,
                        int(row["user_id"]),
                        "run_cancelled" if target is SwarmRunStatus.CANCELLED else "run_failed",
                        metadata={"error_code": "SWARM_SERVICE_RESTARTED"},
                    )

    @staticmethod
    def _run_from_row(row: sqlite3.Row) -> SwarmRun:
        return SwarmRun(
            swarm_run_id=row["swarm_run_id"],
            user_id=row["user_id"],
            request_id=row["request_id"],
            idempotency_key=row["idempotency_key"],
            preset=row["preset"],
            title=row["title"],
            objective=row["objective"],
            status=SwarmRunStatus(row["status"]),
            created_at=row["created_at"],
            queued_at=row["queued_at"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            cancelled_at=row["cancelled_at"],
            timeout_seconds=row["timeout_seconds"],
            max_attempts=row["max_attempts"],
            token_budget=row["token_budget"],
            cost_budget=row["cost_budget"],
            tool_call_budget=row["tool_call_budget"],
            max_workers=row["max_workers"],
            max_tasks=row["max_tasks"],
            max_depth=row["max_depth"],
            task_timeout_seconds=row["task_timeout_seconds"],
            artifact_count_budget=row["artifact_count_budget"],
            artifact_bytes_budget=row["artifact_bytes_budget"],
            progress_event_count_budget=row["progress_event_count_budget"],
            result_summary=row["result_summary"],
            error_code=row["error_code"],
            warnings=_loads(row["warnings_json"], []),
            artifact_refs=[
                ArtifactReference.model_validate(item)
                for item in _loads(row["artifact_refs_json"], [])
            ],
            evidence_refs=[
                EvidenceReference.model_validate(item)
                for item in _loads(row["evidence_refs_json"], [])
            ],
            parameters=_loads(row["parameters_json"], {}),
        )

    @staticmethod
    def _task_from_row(row: sqlite3.Row) -> SwarmTask:
        return SwarmTask(
            task_id=row["task_id"],
            swarm_run_id=row["swarm_run_id"],
            agent_role=row["agent_role"],
            title=row["title"],
            objective=row["objective"],
            dependencies=_loads(row["dependencies_json"], []),
            status=SwarmTaskStatus(row["status"]),
            attempt=row["attempt"],
            max_attempts=row["max_attempts"],
            timeout_seconds=row["timeout_seconds"],
            required_skills=_loads(row["required_skills_json"], []),
            allowed_tools=_loads(row["allowed_tools_json"], []),
            input_refs=_loads(row["input_refs_json"], []),
            output_refs=_loads(row["output_refs_json"], []),
            progress=row["progress"],
            heartbeat_at=row["heartbeat_at"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            error_code=row["error_code"],
            required=bool(row["required"]),
            retryable=bool(row["retryable"]),
        )

    @staticmethod
    def _event_from_row(row: sqlite3.Row) -> SwarmEvent:
        return SwarmEvent(
            sequence=row["sequence"],
            swarm_run_id=row["swarm_run_id"],
            user_id=row["user_id"],
            event_type=row["event_type"],
            task_id=row["task_id"],
            timestamp=row["timestamp"],
            metadata=_loads(row["metadata_json"], {}),
        )
