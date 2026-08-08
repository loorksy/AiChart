"""Durable storage for quant-agent (plan section 1). Own SQLite file, own
tables (`quant_recommendations`, `quant_recommendation_events`,
`quant_strategy_defs`) — nothing here touches, imports, or is named after
anything in the main app's `recommendations` table or its guardrails.

Connection/WAL/locking discipline mirrors
`research-service/app/storage/sqlite.py`: one `asyncio.Lock` serializes all
access, every connection sets `busy_timeout`, and WAL is enabled once at
initialize time.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from app.storage.models import Recommendation, RecommendationEvent, StrategyDef, utc_now_iso


class SqliteQuantStore:
    """Tenant-agnostic (see storage/models.py docstring on visibility) durable
    store for quant-agent recommendations, their lifecycle events, and the
    strategy registry's enable/disable state."""

    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        self._lock = asyncio.Lock()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
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
                    CREATE TABLE IF NOT EXISTS quant_recommendations (
                      id TEXT PRIMARY KEY,
                      owner_user_id INTEGER NOT NULL,
                      symbol TEXT NOT NULL,
                      market TEXT NOT NULL DEFAULT 'forex',
                      interval TEXT NOT NULL,
                      direction TEXT NOT NULL,
                      plan_type TEXT NOT NULL,
                      entry REAL,
                      stop_loss REAL NOT NULL,
                      take_profit REAL,
                      targets_json TEXT NOT NULL DEFAULT '[]',
                      confidence REAL NOT NULL,
                      strategy_id TEXT NOT NULL,
                      strategy_version TEXT NOT NULL,
                      regime TEXT,
                      rationale TEXT NOT NULL,
                      evidence_json TEXT NOT NULL DEFAULT '{}',
                      validity_expires_at TEXT,
                      lifecycle_state TEXT NOT NULL DEFAULT 'active',
                      source_bar_close_time TEXT NOT NULL,
                      idempotency_key TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL,
                      UNIQUE(owner_user_id, idempotency_key)
                    );
                    CREATE INDEX IF NOT EXISTS idx_quant_recs_symbol_created
                      ON quant_recommendations(symbol, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_quant_recs_state_created
                      ON quant_recommendations(lifecycle_state, created_at DESC);

                    CREATE TABLE IF NOT EXISTS quant_recommendation_events (
                      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                      recommendation_id TEXT NOT NULL,
                      owner_user_id INTEGER NOT NULL,
                      sequence INTEGER NOT NULL,
                      event_type TEXT NOT NULL,
                      detail_json TEXT NOT NULL DEFAULT '{}',
                      created_at TEXT NOT NULL,
                      UNIQUE(recommendation_id, sequence),
                      FOREIGN KEY(recommendation_id) REFERENCES quant_recommendations(id)
                        ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_quant_rec_events_rec_seq
                      ON quant_recommendation_events(recommendation_id, sequence);

                    CREATE TABLE IF NOT EXISTS quant_strategy_defs (
                      strategy_id TEXT PRIMARY KEY,
                      version TEXT NOT NULL,
                      display_name TEXT NOT NULL,
                      description TEXT NOT NULL,
                      enabled INTEGER NOT NULL DEFAULT 1,
                      regime_affinity TEXT,
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    );
                    """
                )
                self._migrate_strategy_defs_columns(connection)
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    @staticmethod
    def _migrate_strategy_defs_columns(connection: sqlite3.Connection) -> None:
        """First schema evolution this table has needed (plan section 5) —
        add the two columns the declarative strategy generator needs, if an
        existing database predates them. `PRAGMA table_info` + conditional
        `ALTER TABLE` is the simplest correct migration for a single-file
        SQLite store with no prior migration framework."""
        existing = {
            str(row["name"])
            for row in connection.execute("PRAGMA table_info(quant_strategy_defs)").fetchall()
        }
        if "source_generated" not in existing:
            connection.execute(
                "ALTER TABLE quant_strategy_defs "
                "ADD COLUMN source_generated INTEGER NOT NULL DEFAULT 0"
            )
        if "params_json" not in existing:
            connection.execute("ALTER TABLE quant_strategy_defs ADD COLUMN params_json TEXT")
        if "generation_mode" not in existing:
            connection.execute(
                "ALTER TABLE quant_strategy_defs "
                "ADD COLUMN generation_mode TEXT NOT NULL DEFAULT 'declarative'"
            )
        if "source_code" not in existing:
            connection.execute("ALTER TABLE quant_strategy_defs ADD COLUMN source_code TEXT")

    # ------------------------------------------------------------------
    # recommendations
    # ------------------------------------------------------------------

    async def create_recommendation(
        self, recommendation: Recommendation
    ) -> tuple[Recommendation, bool]:
        async with self._lock:
            with self._connect() as connection:
                existing = connection.execute(
                    """SELECT * FROM quant_recommendations
                    WHERE owner_user_id=? AND idempotency_key=?""",
                    (recommendation.owner_user_id, recommendation.idempotency_key),
                ).fetchone()
                if existing:
                    return self._row_to_recommendation(existing), False
                connection.execute(
                    """INSERT INTO quant_recommendations (
                        id, owner_user_id, symbol, market, interval, direction, plan_type,
                        entry, stop_loss, take_profit, targets_json, confidence, strategy_id,
                        strategy_version, regime, rationale, evidence_json, validity_expires_at,
                        lifecycle_state, source_bar_close_time, idempotency_key, created_at,
                        updated_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    self._recommendation_params(recommendation),
                )
                self._insert_event(
                    connection, recommendation.id, recommendation.owner_user_id, "created", {}
                )
                return recommendation, True

    async def get(self, recommendation_id: str) -> Recommendation | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM quant_recommendations WHERE id=?", (recommendation_id,)
                ).fetchone()
                return self._row_to_recommendation(row) if row else None

    async def list_recommendations(
        self,
        *,
        symbol: str | None = None,
        lifecycle_state: str | None = None,
        owner_user_id: int | None = None,
        limit: int = 50,
    ) -> list[Recommendation]:
        clauses: list[str] = []
        params: list[Any] = []
        if symbol is not None:
            clauses.append("symbol=?")
            params.append(symbol)
        if lifecycle_state is not None:
            clauses.append("lifecycle_state=?")
            params.append(lifecycle_state)
        if owner_user_id is not None:
            clauses.append("owner_user_id=?")
            params.append(owner_user_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(max(1, min(limit, 500)))
        async with self._lock:
            with self._connect() as connection:
                # `where` is built only from a fixed, hardcoded set of
                # `column=?` clauses above -- never from caller-supplied
                # column names or values, which always travel through the
                # `params` placeholders. Nosec/noqa: not a real injection
                # vector, just a query built in two steps.
                rows = connection.execute(
                    f"""SELECT * FROM quant_recommendations {where}
                    ORDER BY created_at DESC LIMIT ?""",  # noqa: S608
                    params,
                ).fetchall()
                return [self._row_to_recommendation(row) for row in rows]

    async def update_lifecycle_state(
        self, recommendation_id: str, lifecycle_state: str, detail: dict[str, Any] | None = None
    ) -> Recommendation | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM quant_recommendations WHERE id=?", (recommendation_id,)
                ).fetchone()
                if not row:
                    return None
                now = utc_now_iso()
                connection.execute(
                    "UPDATE quant_recommendations SET lifecycle_state=?, updated_at=? WHERE id=?",
                    (lifecycle_state, now, recommendation_id),
                )
                updated = self._row_to_recommendation(row)
                updated.lifecycle_state = lifecycle_state  # type: ignore[assignment]
                updated.updated_at = now
                self._insert_event(
                    connection,
                    recommendation_id,
                    updated.owner_user_id,
                    lifecycle_state,
                    detail or {},
                )
                return updated

    async def events(self, recommendation_id: str) -> list[RecommendationEvent]:
        async with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    """SELECT * FROM quant_recommendation_events
                    WHERE recommendation_id=? ORDER BY sequence""",
                    (recommendation_id,),
                ).fetchall()
                return [self._row_to_event(row) for row in rows]

    # ------------------------------------------------------------------
    # strategy registry
    # ------------------------------------------------------------------

    async def seed_strategy_defs(self, strategies: list[StrategyDef]) -> None:
        async with self._lock:
            with self._connect() as connection:
                for strategy in strategies:
                    existing = connection.execute(
                        "SELECT strategy_id FROM quant_strategy_defs WHERE strategy_id=?",
                        (strategy.strategy_id,),
                    ).fetchone()
                    if existing:
                        connection.execute(
                            """UPDATE quant_strategy_defs SET
                                version=?, display_name=?, description=?, regime_affinity=?,
                                updated_at=?
                            WHERE strategy_id=?""",
                            (
                                strategy.version,
                                strategy.display_name,
                                strategy.description,
                                strategy.regime_affinity,
                                utc_now_iso(),
                                strategy.strategy_id,
                            ),
                        )
                    else:
                        connection.execute(
                            """INSERT INTO quant_strategy_defs (
                                strategy_id, version, display_name, description, enabled,
                                regime_affinity, created_at, updated_at
                            ) VALUES (?,?,?,?,?,?,?,?)""",
                            (
                                strategy.strategy_id,
                                strategy.version,
                                strategy.display_name,
                                strategy.description,
                                1 if strategy.enabled else 0,
                                strategy.regime_affinity,
                                strategy.created_at,
                                strategy.updated_at,
                            ),
                        )

    async def list_strategy_defs(self) -> list[StrategyDef]:
        async with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    "SELECT * FROM quant_strategy_defs ORDER BY strategy_id"
                ).fetchall()
                return [self._row_to_strategy_def(row) for row in rows]

    async def upsert_generated_strategy_def(self, strategy_def: StrategyDef) -> StrategyDef | None:
        """Insert or replace a `source_generated=True` row keyed by
        `strategy_id`. Returns `None` (rather than clobbering it) if a row
        with the same `strategy_id` already exists and is *not*
        `source_generated` — this is the defense that keeps a generated spec
        from ever overwriting `ema_trend_v1`/`rsi_reversion_v1`'s seeded
        rows, on top of the API layer's own check."""
        async with self._lock:
            with self._connect() as connection:
                existing = connection.execute(
                    "SELECT source_generated FROM quant_strategy_defs WHERE strategy_id=?",
                    (strategy_def.strategy_id,),
                ).fetchone()
                if existing is not None and not bool(existing["source_generated"]):
                    return None
                now = utc_now_iso()
                if existing is not None:
                    connection.execute(
                        """UPDATE quant_strategy_defs SET
                            version=?, display_name=?, description=?, enabled=?,
                            regime_affinity=?, source_generated=1, params_json=?,
                            generation_mode=?, source_code=?, updated_at=?
                        WHERE strategy_id=?""",
                        (
                            strategy_def.version,
                            strategy_def.display_name,
                            strategy_def.description,
                            1 if strategy_def.enabled else 0,
                            strategy_def.regime_affinity,
                            strategy_def.params_json,
                            strategy_def.generation_mode,
                            strategy_def.source_code,
                            now,
                            strategy_def.strategy_id,
                        ),
                    )
                else:
                    connection.execute(
                        """INSERT INTO quant_strategy_defs (
                            strategy_id, version, display_name, description, enabled,
                            regime_affinity, source_generated, params_json,
                            generation_mode, source_code, created_at, updated_at
                        ) VALUES (?,?,?,?,?,?,1,?,?,?,?,?)""",
                        (
                            strategy_def.strategy_id,
                            strategy_def.version,
                            strategy_def.display_name,
                            strategy_def.description,
                            1 if strategy_def.enabled else 0,
                            strategy_def.regime_affinity,
                            strategy_def.params_json,
                            strategy_def.generation_mode,
                            strategy_def.source_code,
                            strategy_def.created_at,
                            now,
                        ),
                    )
                row = connection.execute(
                    "SELECT * FROM quant_strategy_defs WHERE strategy_id=?",
                    (strategy_def.strategy_id,),
                ).fetchone()
                return self._row_to_strategy_def(row)

    async def set_generated_strategy_enabled(
        self, strategy_id: str, enabled: bool
    ) -> StrategyDef | None:
        """Toggle `enabled` for a `source_generated=True` row only. Returns
        `None` if no such row exists or the row is not `source_generated`
        (the hardcoded strategies must never be reachable through this
        path)."""
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM quant_strategy_defs WHERE strategy_id=?", (strategy_id,)
                ).fetchone()
                if row is None or not bool(row["source_generated"]):
                    return None
                now = utc_now_iso()
                connection.execute(
                    "UPDATE quant_strategy_defs SET enabled=?, updated_at=? WHERE strategy_id=?",
                    (1 if enabled else 0, now, strategy_id),
                )
                updated = self._row_to_strategy_def(row)
                updated.enabled = enabled
                updated.updated_at = now
                return updated

    async def available(self) -> bool:
        try:
            async with self._lock:
                with self._connect() as connection:
                    connection.execute("SELECT 1").fetchone()
            return True
        except (OSError, sqlite3.Error):
            return False

    # ------------------------------------------------------------------
    # internal helpers
    # ------------------------------------------------------------------

    def _insert_event(
        self,
        connection: sqlite3.Connection,
        recommendation_id: str,
        owner_user_id: int,
        event_type: str,
        detail: dict[str, Any],
    ) -> None:
        row = connection.execute(
            """SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence
            FROM quant_recommendation_events WHERE recommendation_id=?""",
            (recommendation_id,),
        ).fetchone()
        connection.execute(
            """INSERT INTO quant_recommendation_events (
                recommendation_id, owner_user_id, sequence, event_type, detail_json, created_at
            ) VALUES (?,?,?,?,?,?)""",
            (
                recommendation_id,
                owner_user_id,
                int(row["next_sequence"]),
                event_type,
                json.dumps(detail, ensure_ascii=False, separators=(",", ":")),
                utc_now_iso(),
            ),
        )

    @staticmethod
    def _recommendation_params(recommendation: Recommendation) -> tuple[Any, ...]:
        return (
            recommendation.id,
            recommendation.owner_user_id,
            recommendation.symbol,
            recommendation.market,
            recommendation.interval,
            recommendation.direction,
            recommendation.plan_type,
            recommendation.entry,
            recommendation.stop_loss,
            recommendation.take_profit,
            json.dumps(recommendation.targets, ensure_ascii=False, separators=(",", ":")),
            recommendation.confidence,
            recommendation.strategy_id,
            recommendation.strategy_version,
            recommendation.regime,
            recommendation.rationale,
            json.dumps(recommendation.evidence, ensure_ascii=False, separators=(",", ":")),
            recommendation.validity_expires_at,
            recommendation.lifecycle_state,
            recommendation.source_bar_close_time,
            recommendation.idempotency_key,
            recommendation.created_at,
            recommendation.updated_at,
        )

    @staticmethod
    def _row_to_recommendation(row: sqlite3.Row) -> Recommendation:
        return Recommendation(
            id=row["id"],
            owner_user_id=row["owner_user_id"],
            symbol=row["symbol"],
            market=row["market"],
            interval=row["interval"],
            direction=row["direction"],
            plan_type=row["plan_type"],
            entry=row["entry"],
            stop_loss=row["stop_loss"],
            take_profit=row["take_profit"],
            targets=json.loads(row["targets_json"]),
            confidence=row["confidence"],
            strategy_id=row["strategy_id"],
            strategy_version=row["strategy_version"],
            regime=row["regime"],
            rationale=row["rationale"],
            evidence=json.loads(row["evidence_json"]),
            validity_expires_at=row["validity_expires_at"],
            lifecycle_state=row["lifecycle_state"],
            source_bar_close_time=row["source_bar_close_time"],
            idempotency_key=row["idempotency_key"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> RecommendationEvent:
        return RecommendationEvent(
            event_id=row["event_id"],
            recommendation_id=row["recommendation_id"],
            owner_user_id=row["owner_user_id"],
            sequence=row["sequence"],
            event_type=row["event_type"],
            detail=json.loads(row["detail_json"]),
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_strategy_def(row: sqlite3.Row) -> StrategyDef:
        # `source_generated`/`params_json`/`generation_mode`/`source_code`
        # are always present by the time any row is read through this
        # store, since `initialize()` runs the migration unconditionally
        # before any query executes.
        row_keys = row.keys()
        generation_mode = row["generation_mode"] if "generation_mode" in row_keys else "declarative"
        return StrategyDef(
            strategy_id=row["strategy_id"],
            version=row["version"],
            display_name=row["display_name"],
            description=row["description"],
            enabled=bool(row["enabled"]),
            regime_affinity=row["regime_affinity"],
            source_generated=bool(row["source_generated"]),
            params_json=row["params_json"],
            generation_mode=generation_mode or "declarative",
            source_code=row["source_code"] if "source_code" in row_keys else None,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

