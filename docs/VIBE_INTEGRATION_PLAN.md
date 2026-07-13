# Vibe Integration Plan

## Delivery rules

- Preserve current chart, execution, MCP and database behavior by default.
- Gate large features and migrations; keep PostgreSQL and SQLite parity.
- Add tests with each slice and never weaken existing assertions.
- Store public reasoning summaries and structured evidence, never raw chain-of-thought.
- Research can recommend or produce paper artifacts; it cannot execute live trades.

## Phase 1 — agent kernel foundations

1. Introduce `web/src/lib/agent/context/` with typed inputs, deterministic token estimation, relevant-turn selection, progressive compaction, tool-pair repair and an orchestrator adapter.
2. Extend existing semantic memory instead of creating Markdown memory. Add source, confidence, expiry, safety classification and tenant-isolation tests.
3. Introduce a lazy `SKILL.md` registry with validated frontmatter. Descriptions load by default; full content and supporting files load only after selection.
4. Introduce a common tool contract, policy and executor with timeout/error normalization. Adapt a small read-only tool set first, then MCP.
5. Add redacted run/step/tool/artifact types and persistence adapters behind a feature flag.

Exit gate: context, history selection, tool-pair, skill discovery/version, permission, timeout, error normalization and cross-user tests pass; current agent regressions pass.

### Phase 1 completion scope (2026-07-13)

- Intent routing now distinguishes same-family specialization from true cross-family requests; broad agent regressions are green.
- Context V2 recalls bounded sanitized semantic memories and Trade Lessons through the existing tenant-scoped stores.
- Semantic memory metadata and recall indexes have PostgreSQL/SQLite parity; auto-write remains disabled.
- The lazy Skill Registry validates the four existing AiChart skills and supplies a shared read-only MCP adapter boundary.
- The common Tool Registry provides server-side policy, validation, timeout/abort, normalized errors, telemetry and two safe read-only adapters.
- Redacted run/step/tool trace persistence exists behind a disabled flag while preserving the existing audit log.

Phase 2 must remain blocked until the final validation commands recorded in the continuation report are green.

### Phase 1A findings (2026-07-12)

The initial five-file Context slice was intentionally small, but was not sufficient for production integration. Its message type represented tool calls and tool results ambiguously, used timestamp-like ordering without a stable sequence contract, had no tenant-authorized adapter, no sanitization or secret classification, no active-recommendation precedence, and could silently omit an oversized message rather than compacting it. It also had no public builder contract or feature-flagged route boundary. The completed Context V2 implementation replaces those assumptions with normalized messages, stable input sequence, pair repair, progressive deterministic compaction, untrusted-context sanitization, an authorized history adapter, a typed recommendation resolver boundary, and an opt-in route/orchestrator input.

Canonical tracked recommendation lookup is deliberately deferred at the Context boundary. The current orchestrator continues to own session recommendation behavior, while Context V2 accepts a resolved recommendation and enforces the documented precedence. Wiring the persistent store into that resolver must happen together with the later single-source-of-truth migration; historical conversation is never used as a substitute.

## Phase 2 — isolated research service

Create `research-service/` as a FastAPI worker with health/readiness, internal authentication, tenant-bound job IDs, idempotency, progress, cancellation, retry/timeout policy, structured errors and artifact references. Prefer an internal HTTP adapter initially; add BullMQ/Redis only when the job persistence contract is stable.

Exit gate: service cannot import or call live execution, cancellation and tenant tests pass, container smoke test proves resource and secret isolation.

### Phase 2 foundation scope (2026-07-13)

- A separate authenticated FastAPI process owns a bounded infrastructure-only job queue.
- Job identity, reads, events, cancellation and artifacts are tenant-bound; creation is idempotent per tenant.
- Cooperative cancellation, timeout, bounded retry, monotonic progress, structured errors and redacted logging are implemented.
- The initial `JobStore` is intentionally volatile and production readiness remains false until a least-privilege durable adapter is configured.
- AiChart integration is a server-only client behind `RESEARCH_SERVICE_ENABLED=0`; no public UI or research API route was added.
- Docker runs non-root with an internal network and restrictive sample controls. At the Phase 2
  checkpoint, no Phase 3 engine or strategy format was present; the later libraries do not weaken
  that boundary.

## Phase 3 — deterministic backtest and validation

Implement a JSON Strategy Specification rather than executing LLM-generated Python. Add versioned strategies and loaders for Candle Warehouse, OANDA, MT5 history, CSV and Parquet. Build deterministic Forex/XAUUSD simulation with spread, commission, slippage, order ordering, partial exits, trailing/break-even, position limits and seeded runs. Add Monte Carlo, bootstrap and walk-forward validation with readiness states: `rejected`, `experimental`, `needs_more_data`, `paper_ready`, `demo_ready`, `live_candidate`.

Exit gate: no-look-ahead, same-candle SL/TP policy, reproducibility, gap, normalization and validation tests pass. No direct transition from backtest to live.

### Phase 3 implementation snapshot (2026-07-13)

Implemented library boundaries:

- strict code-free Strategy Specification, canonical hash/compiler metadata, symbol metadata, and
  volatile immutable versions;
- canonical UTC/Decimal bars, stable dataset hash/quality/gaps, point-in-time higher-timeframe
  alignment, controlled CSV/optional Parquet, and a warehouse-export consumer;
- deterministic indicators and a Forex/XAUUSD bar engine with N-close/N+1-open timing,
  market/limit/stop orders, costs, multiple targets, partial exits, break-even/trailing, account
  state, metrics, and descriptive attribution;
- seeded Monte Carlo/bootstrap, fixed-strategy walk-forward, job-integrated execution-cost and
  allowlisted compiled-strategy sensitivity, and readiness labels that always leave live
  authorization false.

The TypeScript/Python dataset and five-artifact validation contracts are aligned, Phase 3 requests
have appropriate layered size limits, and the disabled-default flags are included in the
environment example. The prior implementation blockers are closed: an above-48-KiB real pipeline,
cooperative statistical cancellation, schema/engine parity, pending-entry intrabar ordering,
weekend/margin fail-closed rules, and bounded strategy-parameter sensitivity all have regression
coverage. The Python/PyArrow, web, and MCP validation matrix passes. Docker image build and
container smoke remain the only unexecuted Phase 3 exit checks because the current host has no
Docker CLI/runtime.

No strategy optimization or parameter search is implemented. No Phase 4 work is authorized by
this snapshot.

## Phase 4 — canonical recommendation feedback

Define one persisted recommendation identity and lifecycle; adapt chat, chart and execution views to it. Outcomes create statistics and learning events. Trade lessons require sufficient evidence. Gold Agent X weight versions require minimum samples, decay, prior-version retention and rollback; Risk Guard limits are immutable to learning.

## Phase 5 — Trading DNA and Shadow Trader

Ingest MT5 trades, AiChart executions, recommendation outcomes, lessons and chart snapshots. Produce tenant-scoped behavioral analysis, a safe strategy specification, shadow backtests and HTML/PDF reports. This plane is analytical and cannot submit orders.

## Phase 6 — research swarm

Add research-only DAG runs with dependencies, upstream summaries, per-agent allowlisted tools/skills, time/token/cost/tool-call budgets, heartbeat, cancellation, partial results, grounded-data-only synthesis and complete structured traces.

## First five implementation slices

1. Bounded context and relevant-history selection integrated behind `AGENT_CONTEXT_V2`.
2. Tenant-safe memory metadata and recall sanitization using the existing semantic store.
3. Lazy skill registry with trust validation and agent/MCP read-only parity.
4. Tool contract plus policy/executor; adapt market/chart read tools first.
5. Research-service job skeleton and sandboxed health/cancellation smoke tests.
