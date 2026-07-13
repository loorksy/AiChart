# AiChart Research Service

An isolated FastAPI process for bounded, tenant-scoped research work. The internal HTTP/job surface
supports Phase 2 smoke jobs and Phase 3 strategy/data/backtest/validation jobs. It has no broker,
MT5, account, approval, recommendation, public research API, or live-order capability.

## Local run

```powershell
python -m pip install -e ".[dev]"
$env:RESEARCH_SERVICE_INTERNAL_TOKEN="replace-with-at-least-32-random-characters"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8090
```

Liveness is public at `GET /health/live`; readiness and all internal job endpoints require the
bearer token plus positive tenant and request headers. Unknown/cross-tenant resource IDs return the
same not-found shape.

## Current job surface

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

Generic create/status/events/cancel/artifact-reference endpoints are documented in
`docs/RESEARCH_SERVICE.md`. Phase 3 types are registered with strict payload dispatch and are forced
to zero retries. TypeScript and Python now share the discriminated dataset and artifact-derived
validation request contracts, but the complete job/artifact/deployment flow is not yet verified.

## Phase 3 libraries

- `app/strategies`: strict declarative strategy schema, canonical hash/compiler metadata, and
  volatile immutable version store.
- `app/data`: canonical UTC bars, validation/quality/hash/gaps/alignment, controlled CSV and
  optional Parquet loaders, and an AiChart warehouse export consumer.
- `app/backtest`: deterministic indicators/conditions, market/limit/stop orders, costs, positions,
  account state, metrics, and descriptive attribution.
- `app/validation`: seeded Monte Carlo/bootstrap, fixed-strategy walk-forward, job-integrated
  execution-cost sensitivity, a bounded trusted standalone sensitivity API, and non-authorizing
  readiness labels.

See the Phase 3 documents in `docs/` before use. They record known execution-policy, deployment,
and integration limitations.

## Storage, artifacts, and security

The job store and strategy store are process-local and volatile. Restart loses state and
idempotency records. Production readiness remains false until least-privilege durable adapters are
implemented.

Artifacts are bounded text/JSON/CSV under a tenant/job-scoped root. Names and paths are controlled,
writes are atomic, and SHA-256 is recorded. Dataset file loaders accept only controlled paths under
an authorized root; no arbitrary URL or network loader exists.

The Strategy Specification contains no executable code. The service exposes no arbitrary Python,
shell, subprocess, pickle, dynamic import, or HTTP tool. `RESEARCH_SERVICE_NETWORK_MODE=disabled`
is the default.

## Feature flags and rollback

AiChart's generic server client is disabled by default:

```text
RESEARCH_SERVICE_ENABLED=0
```

Dedicated `RESEARCH_BACKTEST_ENABLED` and `RESEARCH_VALIDATION_ENABLED` checks exist and require
the exact value `1`; otherwise they remain disabled. Both are listed with value `0` in
`web/.env.example`. The internal token remains server-only.

Rollback is disabling the service flag and stopping the standalone process. Existing AiChart
chart, agent, recommendation, and execution behavior is unchanged.

## Docker and limitations

The image/Compose controls run non-root, read-only, capability-free, resource-bounded, and on an
internal network. Docker image and container-smoke validation must be rerun on a Docker-capable
host; the current Phase 3 validation host has no Docker CLI/runtime.

Additional current limitations:

- Inline warehouse requests are capped at 8 MiB and never truncated; larger exports require a
  future explicit ingest design.
- Holiday/early-close and broker-specific financing calendars are not modeled.
- Strategy sensitivity is deliberately bounded to three allowlisted numeric parameters and 25
  combinations per validation job; it reports outcomes and never selects a winner.
- No optimization/parameter search exists.
- No readiness classification authorizes live trading.
- No Phase 4 behavior is included.
