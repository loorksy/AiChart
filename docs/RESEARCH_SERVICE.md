# AiChart Research Service

## Boundary and current status

The Research Service is a separately deployable FastAPI process with its own internal bearer token,
bounded queue, tenant-bound job state, cancellation, timeout/retry policy, redacted logs, and safe
artifact references. It has no AiChart imports, production database credential, MT5/broker secret,
or live-order route.

Phase 3 library modules for strategies, data, backtesting, and validation are present and registered
with internal research job dispatch. `JobType` contains:

```text
service_smoke_test
artifact_smoke_test
failure_smoke_test
timeout_smoke_test
validate_strategy_spec
validate_dataset
run_forex_backtest
run_backtest_validation
```

Phase 3 jobs validate strict payloads, prohibit retry, emit staged progress, and write bounded
tenant artifacts. The server-only TypeScript/Python dataset and validation request contracts are
aligned. A representative shape check is not a substitute for the still-pending end-to-end job,
artifact, deployment, and failure-path validation matrix.

## Store, queue, and readiness

`JobStore` is interface-backed. Development and test default to the in-memory adapter; production
defaults to the least-privilege SQLite adapter at `RESEARCH_SERVICE_JOB_DB_PATH`. Job state,
idempotency, ordered progress, safe payloads, and artifact references persist on the dedicated
research work volume. A queued job is rescheduled after restart. An interrupted running/retry job
is terminalized as failed with `JOB_SERVICE_RESTARTED`; an interrupted cancellation is
terminalized as cancelled. The service never guesses that interrupted work succeeded.

Production may explicitly select `RESEARCH_SERVICE_STORAGE=memory`, but authenticated readiness
then fails with HTTP 503. The default production selection is `sqlite`.

The bounded `asyncio.Queue` runs outside request handlers with capped concurrency, cooperative
cancellation, timeout, bounded retry, and graceful shutdown. Validation/input errors must not be
made retryable. Future research stages must periodically observe cancellation; merely wrapping a
long synchronous loop in the existing outer timeout is insufficient.

## HTTP contract

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| GET | `/health/live` | none | Process liveness |
| GET | `/health/ready` | internal bearer | Manager/store/artifact readiness |
| POST | `/internal/research/jobs` | bearer + tenant/request headers | Idempotent job creation |
| GET | `/internal/research/jobs/{job_id}` | bearer + tenant/request | Tenant status |
| GET | `/internal/research/jobs/{job_id}/events` | bearer + tenant/request | Ordered progress |
| POST | `/internal/research/jobs/{job_id}/cancel` | bearer + tenant/request | Cooperative cancellation |
| GET | `/internal/research/jobs/{job_id}/artifacts/{artifact_id}` | bearer + tenant/request | Artifact metadata/reference |

Tenant identity is a positive user ID authenticated by the internal caller. Every lookup combines
opaque resource ID and tenant. Unknown and cross-tenant resources share the same not-found shape.

The state machine remains queued/running/retry-wait/cancelling with terminal succeeded, failed,
timed-out, or cancelled states. Progress sequence rises strictly and percentage never regresses.

## Phase 3 integration contract

The implemented research-only job types are:

```text
validate_strategy_spec
validate_dataset
run_forex_backtest
run_backtest_validation
```

Dispatch uses explicit stages:

```text
validate input -> load dataset -> validate data -> compile strategy -> simulate
-> calculate metrics -> validate statistics -> classify readiness -> write artifacts -> complete
```

Payloads must be discriminated, strict, bounded, and tenant-scoped. No arbitrary path, URL, code,
broker credential, retry count, row count, simulation count, or output size is permitted.

The artifact writers emit the files listed in [BACKTEST_ENGINE.md](BACKTEST_ENGINE.md). The
artifact store supports bounded text/JSON/CSV; Parquet is an input format, not an output artifact
type in the current reference model.

Current Phase 3 wire contract:

- datasets are a discriminated union of a tenant artifact reference
  (`source`, `job_id`, `artifact_id`, `format`, optional `column_mapping`) and a bounded inline
  AiChart warehouse envelope;
- backtest validation references a succeeded tenant `run_forex_backtest` job plus its metrics,
  trades, equity, and run-configuration artifact IDs, then supplies a compact bounded validation
  configuration;
- the service gives Phase 3 job envelopes an 8 MiB cap, with stricter inner limits including
  48 KiB for a strategy specification and 8 MiB for inline warehouse data; the TypeScript helper
  enforces the same outer bound.

The inline warehouse path is exercised end to end with a 400-bar payload above 48 KiB. Values above
8 MiB are rejected rather than truncated and require a future explicit upload/ingest design.
Tenant artifact derivation is covered through metrics, trades, equity, validation, readiness, and
sensitivity artifacts.

## AiChart server-only client and flags

The existing TypeScript client supports generic create/get/events/cancel behind:

```text
RESEARCH_SERVICE_ENABLED=0
```

The token is server-only and must never use a `NEXT_PUBLIC_` prefix. Public routes must derive user
identity from AiChart authentication rather than browser fields.

Phase 3 helper methods and dedicated defense-in-depth flags are implemented in server-only code:

```text
RESEARCH_BACKTEST_ENABLED=0
RESEARCH_VALIDATION_ENABLED=0
```

Both flags default disabled because only the exact value `1` enables them. They are listed in
`web/.env.example`. `RESEARCH_SERVICE_NETWORK_MODE=disabled` remains the service-side network
default; Phase 3 does not require arbitrary outbound HTTP.

## Deployment and rollback

The container runs non-root on an internal network with read-only root, dedicated writable roots,
tmpfs work space, dropped capabilities, no-new-privileges, and resource limits. These controls are
defense in depth; the primary safety property is that hostile code is never accepted.

Rollback is disabling `RESEARCH_SERVICE_ENABLED`, stopping the standalone service, and leaving
AiChart chart/agent/recommendation/execution paths unchanged. Future Phase 3 flags must be
independently disableable.

Backup, restore, restart, and release checks are defined in
[PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md). Both `research-work` (SQLite state) and
`research-artifacts` must be backed up as one recovery point.

Docker build, container smoke, restart persistence, crash recovery, and volume restore must be
revalidated for each release against the exact pushed image and recorded in that release's
production-hardening report. Historical Phase validation is not evidence for a later image.
