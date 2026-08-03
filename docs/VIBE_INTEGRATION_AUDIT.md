# Vibe-Trading Integration Audit

Date: 2026-07-12
Safety tag: `pre-vibe-integration-20260712-1912`
Working branch: `feat/vibe-research-kernel`
AiChart baseline: `5ba853c508da2a04aa56e6f08e759113f716ba90`

## Scope and repository state

AiChart is the source of truth. Before this audit the working tree already contained a user change to `.gitignore`, an untracked `.claude/launch.json`, and a content-equivalent working-tree notification for `web/src/lib/chart/tv/tvDatafeed.ts`. These items are preserved and are not integration work.

Vibe-Trading was inspected from `C:\Users\ALALMIA\Documents\LONORA\Vibe-Trading-main`. It is a source archive rather than a Git worktree. Its root license is MIT and its NOTICE identifies HKUDS and separately licensed factor definitions. Direct copies must retain the MIT copyright/permission notice; bundled factor-zoo material needs its own attribution review. This integration initially reimplements ideas and does not copy factor formulas or third-party datasets.

## Existing AiChart architecture to preserve

- `web/src/lib/agent`: the live Smart Chart Agent, intent routing, market context, data-quality and market-sync guards, drawing ownership and commands, risk validation, execution guard, recommendation evaluation, voice support, and regression tests.
- `web/src/lib/strategies`: existing strategy and Gold Agent X implementation. It must be extended through persistent outcome adapters, not replaced.
- `web/src/lib/candles`, `ohlc`, and `markets`: canonical market-data path and Candle Warehouse integration.
- `web/src/lib/recommendations` plus tracked recommendation tables: existing lifecycle foundations. They should become the canonical persisted recommendation boundary.
- `web/src/lib/semanticMemory.ts`, `tradeMemory.ts`, and database tables: existing PostgreSQL/SQLite memory, embeddings, pgvector, and trade lessons. File-based memory is not suitable.
- `mcp/src`: current MCP/OAuth/card surface. New capabilities must be registered here rather than exposed by a second public MCP server.
- `infra`: deployment, Redis/BullMQ, database, MT5 bridge, and operational controls.

These capabilities are protected invariants: TradingView Advanced Charting Library, chart drawing/read/modify/delete, Buy/Sell/Wait and entry/SL/TP rendering, recommendation direction invalidation rules, Market Sync Guard, Data Quality Policy, Risk Guard, explicit confirmation, MT5 bridge / MetaApi cloud connection, OAuth/MCP/SSE, Arabic/English behavior, and tenant isolation.

## Useful Vibe-Trading architecture

- `agent/src/agent/context.py` and `loop.py`: structured request context, on-demand skill descriptions, relevant-memory injection, and preservation of tool-call/tool-result pairs.
- `agent/src/agent/skills.py`: directory discovery and lazy `SKILL.md` loading. The concept maps cleanly to TypeScript, but trust and permission metadata must be stronger.
- `agent/src/agent/tools.py`: a small registry and normalized tool errors. AiChart needs a richer contract with permissions, timeouts, availability, risk and feature flags.
- `agent/src/memory/persistent.py`: memory categories, summaries and relevant recall. Only the concepts are useful; its per-user Markdown storage and keyword-only retrieval are rejected.
- `agent/backtest`: runner, metrics, validation, loader registry and market engines. Forex-oriented algorithms can inform an isolated Python research service after correctness tests; unrelated equity/crypto/China/India connectors are out of scope.
- `agent/src/shadow_account`: extraction, scanning, backtesting and reports. Useful as a research-only Trading DNA model, never as direct execution.
- `agent/src/swarm`: persisted runs, DAG-like presets, progress and grounding. Useful only for long research jobs outside the live-agent latency path.
- `agent/src/agent/trace.py`: structured trace concept. Raw chain-of-thought must never be stored.

## Overlap and real gaps

| Capability | AiChart today | Safe integration decision |
|---|---|---|
| Live chart agent | Mature, chart-aware orchestrator | Preserve; add a context assembly boundary |
| Conversation history | Persisted chat/session mechanisms exist | Add bounded selection and compaction |
| Semantic memory | PostgreSQL/SQLite, embeddings and trade lessons exist | Extend types, source/confidence/expiry and tenant tests |
| Skills | Workspace/static skill material exists | Add lazy, validated registry shared by agent and MCP |
| Tools | Internal, API and MCP tools exist in separate shapes | Introduce a common contract and adapters incrementally |
| Recommendations | Session, rendered and tracked forms coexist | Define persisted tracked recommendation as canonical identity |
| Backtesting | No complete isolated Forex research plane | Build a separate authenticated service and safe strategy DSL |
| Validation | No unified MC/bootstrap/walk-forward gate | Implement in research service with explicit readiness states |
| Run trace | General audit logs exist | Add redacted structured runs/steps/artifacts without CoT |
| Trading DNA | Inputs exist but no consolidated model | Add research-only analysis after canonical outcomes |
| Gold Agent X learning | Journal/performance/setup tables exist | Connect outcomes and version weights with sample thresholds |
| Research swarm | Live agents exist; long-job plane is missing | Add bounded research DAG; do not replace orchestrator |

## Incomplete or risky areas found

- Context and recommendation state are represented across session, chat, chart and persistence layers; identity and precedence need explicit contracts.
- Database bootstrap schemas are maintained in both PostgreSQL and SQLite files; every new table requires parity tests and reversible migration planning.
- The repository contains fallback and in-memory paths. Each must be classified as deliberate resilience, test fixture, or production-state risk before removal.
- Gold Agent X already has journal/performance/setup persistence. Creating parallel learning tables without adapters would fragment outcomes.
- Vibe tools include broad research and local execution assumptions. Shell, arbitrary Python/file writes, and unneeded market connectors cannot enter the live trading process.
- Vibe's memory snapshots may carry untrusted prose into prompts. AiChart memory recall needs secret rejection, instruction neutralization, provenance and tenant-scoped queries.

## Copy/adapt classification

| Area | Classification | Rationale |
|---|---|---|
| Context/compaction algorithms | Reimplemented, idea only | TypeScript integration and AiChart message types differ |
| Skill discovery/frontmatter | Adapted concept | Add trust, locale, market, tool and risk validation |
| Tool registry | Reimplemented, idea only | AiChart requires permissions and live-trading guards |
| Markdown persistent memory | Rejected | Breaks tenant isolation and duplicates semantic memory |
| Backtest/validation core | Deferred adaptation | Requires isolated service and deterministic correctness suite |
| Loader registry | Adapted concept | Only Warehouse, OANDA, MT5, CSV and Parquet are relevant |
| Shadow account/reporting | Deferred reimplementation | Must derive from canonical AiChart outcomes and remain research-only |
| Swarm runtime/presets | Deferred reimplementation | Must use bounded jobs, grounded inputs and cost controls |
| Factor zoo and unrelated markets | Rejected | Scope, dependency and attribution risk |

## Security requirements

Research workers must be separate from Next.js, authenticated internally, tenant-scoped, unable to call trade execution, and run dynamic work in containers with no platform secrets, no production DB credentials, no network by default, read-only inputs, resource/time/output limits and a kill switch. Live tools retain feature flags, authorization, Risk Guard, Execution Guard, explicit confirmation, idempotency, account/environment/spread/staleness checks and audit logging.

## Planned files

Phase 1 adds bounded context, skill and tool contracts below `web/src/lib/agent/`, their tests, and adapters into the existing orchestrator. Later phases add `research-service/`, database migrations with PostgreSQL/SQLite parity, API/MCP adapters, and minimal AiChart-native result views. Exact later files are gated by the interfaces and tests defined in `VIBE_INTEGRATION_PLAN.md`.

## Conclusion

The safest route is not a broad port. Phase 1 should first establish bounded context and registries behind feature flags. The research service follows as an independently testable plane. Canonical recommendation outcomes must precede adaptive learning, Trading DNA and swarm work because all three depend on trustworthy, tenant-scoped result data.
