# Production Operations

## Release preflight

Deploy only an exact, pushed `origin/main` commit from a clean VPS worktree. Record the commit,
UTC time, Docker image digest, PM2 process list, Compose configuration, database backup path, and
the enabled feature flags. Never print `.env`, database URLs, bearer tokens, authorization
headers, or private keys into a release log.

Required fail-closed defaults are:

```text
RESEARCH_SERVICE_ENABLED=0
RESEARCH_BACKTEST_ENABLED=0
RESEARCH_VALIDATION_ENABLED=0
RESEARCH_SWARM_ENABLED=0
RESEARCH_SWARM_PRESETS_ENABLED=0
AGENT_CONTEXT_V2=0
AGENT_MEMORY_WRITE_V1=0
AGENT_RUN_TRACE_V1=0
BINANCE_CAPTURE_ENABLED=0
TRADINGVIEW_MCP_ENABLED=0
FEATURE_AGENT_EXECUTION_GUARD=1
```

Enabling Research requires a 32-or-more-character internal token, an isolated Docker profile,
`RESEARCH_SERVICE_STORAGE=sqlite`, and persistent `research-work` plus `research-artifacts`
volumes. No Research flag grants broker or execution permission.

## Backup

Use `umask 077` and a root-owned destination outside the repository. Create a PostgreSQL custom
dump with `pg_dump --format=custom`; validate it with `pg_restore --list`. For SQLite fallback,
use `sqlite3 /path/to/aichart.db '.backup /backup/aichart.db'`, never a live byte-for-byte copy.

For Docker state, snapshot the Compose volumes for:

- `research-work` (generic jobs and Swarm SQLite, including WAL-consistent files after services
  are stopped);
- `research-artifacts` (must share the same recovery point as research state);
- `redis-data` after `redis-cli BGSAVE` reports success;
- `aichart-data` when Docker SQLite fallback is in use.

Stop the Research container before archiving its two volumes so SQLite and artifacts form one
consistent recovery point. PostgreSQL remains the authority when `DATABASE_URL` is configured.
Do not include plaintext `.env` in a general-purpose archive; back it up separately with mode 600
and the operator's encrypted secret-storage process.

## Restore drill

Never test restore over production. Restore PostgreSQL into a newly created scratch database,
run `pg_restore --exit-on-error`, and compare schema/table counts plus tenant-scoped sample rows.
Run `PRAGMA integrity_check` on restored SQLite files. Start a disposable Research container with
restored volumes, verify authenticated `/health/ready`, retrieve an existing job and artifact by
its owning tenant, verify a different tenant receives not-found, then delete the disposable
environment.

Redis is a cache/coordination layer rather than the canonical trading record. A Redis restore must
prove `PING`, key readability, TTL behavior, and application recovery; canonical PostgreSQL or
SQLite records remain authoritative.

## Restart and rollback

Graceful shutdown stops accepting work, signals active jobs, bounds queue drain, and then stops
workers. After an ungraceful Research restart, queued jobs resume; abandoned running work is
failed with `JOB_SERVICE_RESTARTED`; cancellation in progress becomes cancelled. Swarm uses the
corresponding `SWARM_SERVICE_RESTARTED` policy.

Rollback disables optional flags first, restores the prior pushed commit/image without rewriting
Git history, and leaves databases/artifacts intact. Execution Guard must remain enabled. A rollback
must not delete volumes, clear Redis, truncate audit data, or bypass recommendation/execution
authorization.
