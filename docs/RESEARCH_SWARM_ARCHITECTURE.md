# Research Swarm architecture

Status: Phase 6 design decision, written before implementation.

## Objective and non-goals

The Research Swarm is a tenant-scoped, long-running research facility. It coordinates a reviewed task graph, persists public-safe structured outputs, and produces evidence-linked synthesis. It is not part of the Smart Chart Agent request path and it cannot place, modify, close, or manage a trade.

Phase 6 does not add a public MCP server, a general autonomous-agent loop, user-defined DAGs, arbitrary code execution, or a new market-data connector. Existing Research Service, backtest, validation, canonical recommendation, Trading DNA, Shadow Trader, Agent Run Trace, Tool Registry, and Skill Registry contracts remain authoritative in their current domains.

## Audited runtime

AiChart already provides the following boundaries:

- `web/src/lib/research/` is a server-only internal HTTP client. It enforces disabled-default rollout, tenant headers, request IDs, bearer authentication, bounded client timeouts, and normalized service errors.
- `research-service/app/security.py` authenticates the internal bearer token and derives the caller's positive tenant ID and request ID from trusted internal headers.
- `research-service/app/jobs/` supplies a bounded asynchronous queue, cooperative cancellation, timeout handling, retry classification, monotonic progress, and worker containment for Phase 2/3 jobs.
- `research-service/app/storage/artifacts.py` supplies tenant/job-scoped paths, symlink and traversal rejection, atomic writes, count/size limits, hashes, and safe artifact types.
- `research-service/app/backtest/` and `research-service/app/validation/` are the only deterministic backtest and statistical-validation implementations. Swarm code may reference their jobs and artifacts but must not duplicate their calculations.
- Canonical recommendations, learning events, Trading DNA snapshots, and Shadow recommendations remain authoritative in their existing TypeScript repositories and database schemas.
- The Phase 1 Tool Registry and Skill Registry define server-side permissions and reviewed skill metadata. A swarm role can narrow those policies; it can never expand them.
- Agent Run Trace records short public-safe summaries for the live agent. Research Swarm events use their own run/task identity and do not duplicate live-agent traces or store hidden reasoning.
- The current Research Service `JobStore` is intentionally in-memory. Its health endpoint correctly reports production storage as volatile unless a durable adapter is configured.

## Vibe-Trading concept audit

The local Vibe-Trading tree was reviewed directly, especially `agent/src/swarm/`, its preset YAML files, `worker.py`, `runtime.py`, `models.py`, `task_store.py`, `store.py`, `grounding.py`, the swarm API/tool adapters, agent context/loop/trace/tools/skills, backtest material, and `shadow_account/`. Requested names such as `orchestrator.py`, `state.py`, and `storage.py` are not present in that swarm directory; their responsibilities are distributed across the files above.

Classification:

| Concept | Classification | AiChart decision |
| --- | --- | --- |
| DAG validation and deterministic dependency layers | idea only, reimplemented | Use typed reviewed presets, cycle/missing-dependency checks, and stable topological order. |
| Bounded concurrent workers | idea only, reimplemented | Use `asyncio` tasks and semaphores inside the existing Research Service process. |
| Per-task timeout, heartbeat, stale detection, retry, cancellation | idea only, reimplemented | Use AiChart status contracts, append-only events, cooperative cancellation, and server maxima. |
| Bounded upstream summaries and artifact aggregation | idea only, reimplemented | Pass typed outputs, evidence references, limitations, and artifact references only. |
| Grounding before synthesis | adapted concept | Enforce AiChart evidence-reference types and `insufficient_evidence`; do not import Vibe market loaders or prose. |
| Reviewed role/preset definitions | idea only, reimplemented | Seven AiChart-specific presets and research-only role policy bundles. No Vibe YAML is copied. |
| Markdown/JSON files as production run state | rejected | Use a least-privilege SQLite adapter and append-only event history. |
| ReAct loop and hidden reasoning persistence | rejected | Workers return validated public-safe structures; no chain-of-thought is requested or stored. |
| `bash`, generated Python, dynamic imports, read/write/edit file tools | rejected | No shell, subprocess, `eval`, `exec`, arbitrary import, or arbitrary filesystem capability exists. |
| Unrestricted or connector-specific HTTP/market tools | rejected | Only reviewed AiChart tool names and existing deterministic Research Service functions are eligible. |
| Broker, MT5, trading connector, or live execution tools | rejected | The deny set is enforced in roles, presets, static validation, and tests. |
| Factor zoo, shadow-account code generation, unrelated connectors | rejected | Outside AiChart Phase 6 scope and trust boundary. |
| User-authored presets or recursive worker spawning | deferred/rejected for Phase 6 | Only versioned server-owned presets are accepted; tasks cannot create tasks. |
| Copied source, prompt, formula, test, dataset, template, or report prose | copied with attribution: none | Phase 6 is independently implemented against AiChart contracts. |

## Runtime split and trust boundaries

```text
authenticated AiChart server session
  -> server-only TypeScript Research client
     -> internal bearer + tenant/request headers
        -> Research Service swarm API
           -> preset registry and policy validation
           -> durable swarm store and bounded scheduler
           -> reviewed research-only worker handlers
           -> existing tenant-scoped artifact store
```

TypeScript responsibilities:

- expose disabled-default flags `RESEARCH_SWARM_ENABLED` and `RESEARCH_SWARM_PRESETS_ENABLED`;
- accept only tenant identity derived from the authenticated server session;
- validate bounded request shapes and reviewed preset names;
- call internal endpoints and present status, task, event, and artifact references;
- make no Research Service network call while either required flag is disabled;
- never send the internal bearer token to browser code;
- never execute a worker.

Python Research Service responsibilities:

- validate preset parameters and clamp user-requested budgets below immutable server maxima;
- create tenant-scoped run/task/dependency records and append the initial audit events atomically;
- schedule a fixed DAG with fixed concurrency, task/run timeouts, cooperative cancellation, deterministic retry policy, heartbeat and stale-worker handling;
- validate role tool/skill allowlists and structured grounded outputs;
- persist results before releasing dependants;
- synthesize supported, conflicting, risk, strategy, validation, Trading DNA, and limitation sections without recalculating source metrics;
- write only allowlisted tenant/run-scoped artifacts through the existing safe artifact store.

Trust boundaries:

- The internal bearer authenticates the AiChart server, while `X-AiChart-User-Id` and `X-AiChart-Request-Id` scope every read, cancellation, event, output, and artifact query.
- Evidence references originate from server-side AiChart integrations. The Research Service rejects references whose owner does not match the caller and accepts only allowlisted identifier types and shapes. It never treats user prose as evidence.
- Role and preset policy is immutable server code. Upstream task output and skill content are data, never policy.
- Research readiness is evidence, not live-trading approval. Risk Guard and Execution Guard remain outside the swarm and cannot be overridden.

## Persistence decision

Phase 6 uses a dedicated SQLite database under the Research Service writable work volume, configurable only by a server environment variable. It uses no AiChart application database credentials and therefore has least privilege. The smallest coherent schema contains:

- materialized `research_swarm_runs` and `research_swarm_tasks` for bounded reads;
- immutable `research_swarm_dependencies`;
- append-only `research_swarm_events` for every state transition and safe operational event;
- immutable `research_swarm_outputs` for validated task outputs;
- append-only `research_swarm_usage` for budget consumption.

State rows provide the current projection; transition history is never overwritten. Every status update and corresponding event is committed in one SQLite transaction. WAL mode, foreign keys, busy timeout, and deterministic indexes are enabled. Startup reconciliation cancels/terminates abandoned running work safely and requeues only previously queued runs. Markdown is never runtime state.

Rollback is non-destructive: set both TypeScript flags to `0`, stop accepting swarm requests, and retain the SQLite database and artifact volume for audit or deletion under the normal tenant-retention process. Existing Phase 2/3 job tables and AiChart PostgreSQL/SQLite schemas require no migration.

## Queue and worker model

A dedicated bounded swarm manager lives beside the existing `JobManager` in the same FastAPI application. This avoids changing completed Phase 2/3 dispatch while reusing settings, authentication, error normalization, shutdown, and artifacts. It has a bounded run queue and fixed run-worker count. Each active run owns one semaphore capped by the approved `max_workers`; tasks never spawn new graph nodes.

Run creation accepts only one of seven reviewed presets and bounded parameters. DAG validation precedes queueing. Tasks move through explicit states. Required dependencies must succeed; failed required dependencies cause deterministic skip propagation. Optional tasks are not dependencies of synthesis unless the preset explicitly requires them, so their failure may yield `partially_completed` with named missing sections.

Cancellation is cooperative and tenant-scoped. A per-run artifact lock serializes cancellation with artifact writes, preventing writes after terminal cancellation. Timeout and shutdown set the same cancellation signal, await children, and leave no orphan task. Only explicitly retryable worker failures retry, with a fixed capped backoff; authentication, validation, budget, cancellation, and timeout failures never retry.

## Tool, skill, and worker decision

Roles are policy bundles, not identities. They declare a purpose, reviewed skills, allowed research tool names, output schema, required/optional classification, timeout, token budget, and tool-call budget. A central validator rejects any permission/tool name associated with write, execution, broker, MT5, shell, arbitrary network, file, or database access.

The Phase 6 runtime is deterministic and handler-based; it is not a general model-driven ReAct loop. A handler can consume bounded preset parameters, verified evidence references, existing Research Service job/artifact references, and structured upstream outputs. Unsupported data produces an `insufficient_evidence` claim and limitation instead of an invented value. Backtest/validation calculations remain delegated to the existing deterministic engines through reviewed adapters when the preset provides valid references.

## Grounding and context contract

Each task output separates `facts`, `calculations`, `inferences`, `hypotheses`, `limitations`, and `evidence_refs`. Facts and calculations require at least one tenant-valid evidence reference. An unsupported item is represented explicitly with status `insufficient_evidence`; it is not silently promoted to a fact. Hidden reasoning fields are forbidden recursively.

Dependent tasks receive a deterministic projection capped by item count and encoded byte size. The projection preserves typed numeric values exactly, reference IDs, and limitations. It drops excess narrative items rather than rewriting numbers. Full histories, raw tool payloads, bearer data, and environment values are never forwarded.

Synthesis consumes only those projections. It can organize, compare, surface conflicts and limitations, and recommend further research. It cannot recompute a metric, manufacture evidence, suppress disagreement, or authorize execution.

## API and observability

Internal endpoints are mounted at `/internal/research/swarms`. All use existing internal authentication and tenant context. The create body deliberately omits `user_id`; ownership always comes from the authenticated header context. Read and cancellation lookups return not-found semantics across tenants.

Safe events include creation, DAG validation, task readiness/start/completion/failure/retry/cancellation, tool-call metadata, missed heartbeat, budget exhaustion, synthesis start/completion, and terminal run status. Payloads are redacted, allowlisted, and byte-limited. Raw prompts, complete payloads, tool bodies, environment values, and chain-of-thought are excluded.

## Deployment boundary

The existing container remains non-root, capability-dropped, read-only, and internally networked. The writable work/artifact volumes are the only persistence locations. The swarm SQLite path must resolve inside the configured work root. No Docker socket, host filesystem, SSH, browser, broker credential, or public port is added.
