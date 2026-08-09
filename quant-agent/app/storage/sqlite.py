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

from app.storage.models import (
    BacktestMetrics,
    BacktestRun,
    BotDefinition,
    BotFill,
    BotLedgerEntry,
    BotRun,
    Recommendation,
    RecommendationEvent,
    StrategyDef,
    utc_now_iso,
)


def _dumps(value: Any) -> str:
    """The one JSON spelling this store uses for every JSON column."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


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

                    CREATE TABLE IF NOT EXISTS quant_backtest_runs (
                      id TEXT PRIMARY KEY,
                      strategy_id TEXT NOT NULL,
                      strategy_version TEXT NOT NULL,
                      symbol TEXT NOT NULL,
                      market TEXT NOT NULL DEFAULT 'forex',
                      interval TEXT NOT NULL,
                      bar_count INTEGER NOT NULL,
                      from_time TEXT NOT NULL,
                      to_time TEXT NOT NULL,
                      status TEXT NOT NULL,
                      metrics_json TEXT NOT NULL DEFAULT '{}',
                      warnings_json TEXT NOT NULL DEFAULT '[]',
                      created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_quant_backtest_runs_strategy_created
                      ON quant_backtest_runs(strategy_id, created_at DESC);

                    -- Automated bots. SIMULATION ONLY: every row under these
                    -- four tables is the output of a replay against pushed-in
                    -- bars, never a venue. `execution_mode` is stored rather
                    -- than assumed so a row read years from now still says so
                    -- out loud.
                    --
                    -- `owner_user_id` is on all four, not just the definition.
                    -- Denormalized on purpose: it lets every by-id read filter
                    -- on ownership in one indexed predicate instead of joining
                    -- back to the parent, which is the shape an authz bug
                    -- likes to hide in.
                    CREATE TABLE IF NOT EXISTS quant_bots (
                      id TEXT PRIMARY KEY,
                      owner_user_id INTEGER NOT NULL,
                      bot_type TEXT NOT NULL,
                      name TEXT NOT NULL,
                      symbol TEXT NOT NULL,
                      market TEXT NOT NULL DEFAULT 'forex',
                      interval TEXT NOT NULL,
                      execution_mode TEXT NOT NULL DEFAULT 'simulation',
                      initial_capital REAL NOT NULL DEFAULT 0,
                      fee_rate REAL NOT NULL DEFAULT 0.001,
                      config_json TEXT NOT NULL DEFAULT '{}',
                      levels_json TEXT NOT NULL DEFAULT '[]',
                      warnings_json TEXT NOT NULL DEFAULT '[]',
                      diagnostics_json TEXT NOT NULL DEFAULT '[]',
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_quant_bots_owner_created
                      ON quant_bots(owner_user_id, created_at DESC);

                    CREATE TABLE IF NOT EXISTS quant_bot_runs (
                      id TEXT PRIMARY KEY,
                      bot_id TEXT NOT NULL,
                      owner_user_id INTEGER NOT NULL,
                      execution_mode TEXT NOT NULL DEFAULT 'simulation',
                      status TEXT NOT NULL,
                      bar_count INTEGER NOT NULL DEFAULT 0,
                      from_time TEXT NOT NULL DEFAULT '',
                      to_time TEXT NOT NULL DEFAULT '',
                      cells_bootstrapped INTEGER NOT NULL DEFAULT 0,
                      orders_placed INTEGER NOT NULL DEFAULT 0,
                      fill_count INTEGER NOT NULL DEFAULT 0,
                      matched_cycles INTEGER NOT NULL DEFAULT 0,
                      realized_profit REAL NOT NULL DEFAULT 0,
                      unrealized_profit REAL NOT NULL DEFAULT 0,
                      total_commission REAL NOT NULL DEFAULT 0,
                      ending_price REAL NOT NULL DEFAULT 0,
                      resting_orders INTEGER NOT NULL DEFAULT 0,
                      stop_reason TEXT NOT NULL DEFAULT '',
                      warnings_json TEXT NOT NULL DEFAULT '[]',
                      logs_json TEXT NOT NULL DEFAULT '[]',
                      cells_json TEXT NOT NULL DEFAULT '[]',
                      error TEXT,
                      created_at TEXT NOT NULL,
                      FOREIGN KEY(bot_id) REFERENCES quant_bots(id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_quant_bot_runs_bot_created
                      ON quant_bot_runs(bot_id, created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_quant_bot_runs_owner_created
                      ON quant_bot_runs(owner_user_id, created_at DESC);

                    CREATE TABLE IF NOT EXISTS quant_bot_fills (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      run_id TEXT NOT NULL,
                      owner_user_id INTEGER NOT NULL,
                      sequence INTEGER NOT NULL,
                      bar_time TEXT NOT NULL,
                      cell_index INTEGER NOT NULL DEFAULT -1,
                      purpose TEXT NOT NULL DEFAULT '',
                      price REAL NOT NULL DEFAULT 0,
                      quantity REAL NOT NULL DEFAULT 0,
                      UNIQUE(run_id, sequence),
                      FOREIGN KEY(run_id) REFERENCES quant_bot_runs(id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_quant_bot_fills_run
                      ON quant_bot_fills(run_id, sequence);

                    CREATE TABLE IF NOT EXISTS quant_bot_ledger (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      run_id TEXT NOT NULL,
                      owner_user_id INTEGER NOT NULL,
                      sequence INTEGER NOT NULL,
                      trade_type TEXT NOT NULL,
                      close_reason TEXT NOT NULL DEFAULT '',
                      cell_index INTEGER NOT NULL DEFAULT -1,
                      price REAL NOT NULL DEFAULT 0,
                      amount REAL NOT NULL DEFAULT 0,
                      commission REAL NOT NULL DEFAULT 0,
                      profit REAL,
                      matched_entry_price REAL,
                      grid_matched_profit REAL,
                      UNIQUE(run_id, sequence),
                      FOREIGN KEY(run_id) REFERENCES quant_bot_runs(id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_quant_bot_ledger_run
                      ON quant_bot_ledger(run_id, sequence);
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

    # ------------------------------------------------------------------
    # backtest runs
    # ------------------------------------------------------------------

    async def create_backtest_run(self, run: BacktestRun) -> BacktestRun:
        """Always an INSERT — unlike recommendations, backtest runs have no
        idempotency key (the same strategy/symbol/interval/bar-window can
        legitimately be backtested repeatedly, e.g. across generate-and-fix
        rounds) and no dedup path is needed."""
        async with self._lock:
            with self._connect() as connection:
                connection.execute(
                    """INSERT INTO quant_backtest_runs (
                        id, strategy_id, strategy_version, symbol, market, interval,
                        bar_count, from_time, to_time, status, metrics_json, warnings_json,
                        created_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    self._backtest_run_params(run),
                )
                return run

    async def get_backtest_run(self, run_id: str) -> BacktestRun | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM quant_backtest_runs WHERE id=?", (run_id,)
                ).fetchone()
                return self._row_to_backtest_run(row) if row else None

    # ------------------------------------------------------------------
    # bots (simulation only)
    #
    # EVERY accessor here takes `owner_user_id` and filters on it in SQL.
    # There is no `get_bot(bot_id)` overload without an owner, deliberately:
    # an unscoped read is the exact shape of the authz hole we closed on the
    # strategy-enable route, and the cheapest way not to reintroduce it is not
    # to offer the function.
    # ------------------------------------------------------------------

    async def create_bot(self, bot: BotDefinition) -> BotDefinition:
        async with self._lock:
            with self._connect() as connection:
                connection.execute(
                    """INSERT INTO quant_bots (
                        id, owner_user_id, bot_type, name, symbol, market, interval,
                        execution_mode, initial_capital, fee_rate, config_json, levels_json,
                        warnings_json, diagnostics_json, created_at, updated_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        bot.id,
                        bot.owner_user_id,
                        bot.bot_type,
                        bot.name,
                        bot.symbol,
                        bot.market,
                        bot.interval,
                        bot.execution_mode,
                        bot.initial_capital,
                        bot.fee_rate,
                        _dumps(bot.config),
                        _dumps(bot.levels),
                        _dumps(bot.warnings),
                        _dumps(bot.risk_diagnostics),
                        bot.created_at,
                        bot.updated_at,
                    ),
                )
                return bot

    async def get_bot(self, owner_user_id: int, bot_id: str) -> BotDefinition | None:
        async with self._lock:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT * FROM quant_bots WHERE id=? AND owner_user_id=?",
                    (bot_id, int(owner_user_id)),
                ).fetchone()
                return self._row_to_bot(row) if row else None

    async def list_bots(self, owner_user_id: int, *, limit: int = 50) -> list[BotDefinition]:
        async with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    """SELECT * FROM quant_bots WHERE owner_user_id=?
                    ORDER BY created_at DESC LIMIT ?""",
                    (int(owner_user_id), max(1, min(int(limit), 200))),
                ).fetchall()
                return [self._row_to_bot(row) for row in rows]

    async def delete_bot(self, owner_user_id: int, bot_id: str) -> bool:
        async with self._lock:
            with self._connect() as connection:
                cursor = connection.execute(
                    "DELETE FROM quant_bots WHERE id=? AND owner_user_id=?",
                    (bot_id, int(owner_user_id)),
                )
                return cursor.rowcount > 0

    async def create_bot_run(
        self,
        run: BotRun,
        fills: list[BotFill],
        ledger: list[BotLedgerEntry],
    ) -> BotRun:
        """Persist a finished simulation and its two child logs in one
        transaction — a run whose fills failed to land would misreport its own
        arithmetic."""
        async with self._lock:
            with self._connect() as connection:
                connection.execute(
                    """INSERT INTO quant_bot_runs (
                        id, bot_id, owner_user_id, execution_mode, status, bar_count,
                        from_time, to_time, cells_bootstrapped, orders_placed, fill_count,
                        matched_cycles, realized_profit, unrealized_profit, total_commission,
                        ending_price, resting_orders, stop_reason, warnings_json, logs_json,
                        cells_json, error, created_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        run.id,
                        run.bot_id,
                        run.owner_user_id,
                        run.execution_mode,
                        run.status,
                        run.bar_count,
                        run.from_time,
                        run.to_time,
                        run.cells_bootstrapped,
                        run.orders_placed,
                        run.fill_count,
                        run.matched_cycles,
                        run.realized_profit,
                        run.unrealized_profit,
                        run.total_commission,
                        run.ending_price,
                        run.resting_orders,
                        run.stop_reason,
                        _dumps(run.warnings),
                        _dumps(run.logs),
                        _dumps(run.cells),
                        run.error,
                        run.created_at,
                    ),
                )
                connection.executemany(
                    """INSERT INTO quant_bot_fills (
                        run_id, owner_user_id, sequence, bar_time, cell_index, purpose,
                        price, quantity
                    ) VALUES (?,?,?,?,?,?,?,?)""",
                    [
                        (
                            fill.run_id,
                            fill.owner_user_id,
                            fill.sequence,
                            fill.bar_time,
                            fill.cell_index,
                            fill.purpose,
                            fill.price,
                            fill.quantity,
                        )
                        for fill in fills
                    ],
                )
                connection.executemany(
                    """INSERT INTO quant_bot_ledger (
                        run_id, owner_user_id, sequence, trade_type, close_reason, cell_index,
                        price, amount, commission, profit, matched_entry_price,
                        grid_matched_profit
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    [
                        (
                            entry.run_id,
                            entry.owner_user_id,
                            entry.sequence,
                            entry.trade_type,
                            entry.close_reason,
                            entry.cell_index,
                            entry.price,
                            entry.amount,
                            entry.commission,
                            entry.profit,
                            entry.matched_entry_price,
                            entry.grid_matched_profit,
                        )
                        for entry in ledger
                    ],
                )
                return run

    async def list_bot_runs(
        self, owner_user_id: int, bot_id: str, *, limit: int = 20
    ) -> list[BotRun]:
        async with self._lock:
            with self._connect() as connection:
                rows = connection.execute(
                    """SELECT * FROM quant_bot_runs WHERE bot_id=? AND owner_user_id=?
                    ORDER BY created_at DESC LIMIT ?""",
                    (bot_id, int(owner_user_id), max(1, min(int(limit), 100))),
                ).fetchall()
                return [self._row_to_bot_run(row) for row in rows]

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
    def _backtest_run_params(run: BacktestRun) -> tuple[Any, ...]:
        return (
            run.id,
            run.strategy_id,
            run.strategy_version,
            run.symbol,
            run.market,
            run.interval,
            run.bar_count,
            run.from_time,
            run.to_time,
            run.status,
            json.dumps(
                run.metrics.model_dump() if run.metrics is not None else {},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            json.dumps(run.warnings, ensure_ascii=False, separators=(",", ":")),
            run.created_at,
        )

    @staticmethod
    def _row_to_backtest_run(row: sqlite3.Row) -> BacktestRun:
        metrics_raw = json.loads(row["metrics_json"])
        metrics = BacktestMetrics.model_validate(metrics_raw) if metrics_raw else None
        return BacktestRun(
            id=row["id"],
            strategy_id=row["strategy_id"],
            strategy_version=row["strategy_version"],
            symbol=row["symbol"],
            market=row["market"],
            interval=row["interval"],
            bar_count=row["bar_count"],
            from_time=row["from_time"],
            to_time=row["to_time"],
            status=row["status"],
            metrics=metrics,
            warnings=json.loads(row["warnings_json"]),
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_bot(row: sqlite3.Row) -> BotDefinition:
        return BotDefinition(
            id=row["id"],
            owner_user_id=int(row["owner_user_id"]),
            bot_type=row["bot_type"],
            name=row["name"],
            symbol=row["symbol"],
            market=row["market"],
            interval=row["interval"],
            execution_mode="simulation",
            initial_capital=float(row["initial_capital"]),
            fee_rate=float(row["fee_rate"]),
            config=json.loads(row["config_json"]),
            levels=json.loads(row["levels_json"]),
            warnings=json.loads(row["warnings_json"]),
            risk_diagnostics=json.loads(row["diagnostics_json"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_bot_run(row: sqlite3.Row) -> BotRun:
        return BotRun(
            id=row["id"],
            bot_id=row["bot_id"],
            owner_user_id=int(row["owner_user_id"]),
            # Read as the literal, never from the column: a row that somehow
            # carried another value must not be able to relabel itself.
            execution_mode="simulation",
            status=row["status"],
            bar_count=int(row["bar_count"]),
            from_time=row["from_time"],
            to_time=row["to_time"],
            cells_bootstrapped=int(row["cells_bootstrapped"]),
            orders_placed=int(row["orders_placed"]),
            fill_count=int(row["fill_count"]),
            matched_cycles=int(row["matched_cycles"]),
            realized_profit=float(row["realized_profit"]),
            unrealized_profit=float(row["unrealized_profit"]),
            total_commission=float(row["total_commission"]),
            ending_price=float(row["ending_price"]),
            resting_orders=int(row["resting_orders"]),
            stop_reason=row["stop_reason"],
            warnings=json.loads(row["warnings_json"]),
            logs=json.loads(row["logs_json"]),
            cells=json.loads(row["cells_json"]),
            error=row["error"],
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

