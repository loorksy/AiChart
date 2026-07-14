# AiChart Research Swarm

The Research Swarm coordinates reviewed, tenant-scoped research tasks inside the isolated Python Research Service. It is separate from the Smart Chart Agent and has no order, broker, MT5, chart-write, shell, file-tool, arbitrary-network, or arbitrary-database capability.

See `RESEARCH_SWARM_ARCHITECTURE.md` for the architecture audit and `RESEARCH_SWARM_SECURITY.md` for the threat model.

## Enablement and API

All three server flags must equal `1` before the TypeScript client calls the service:

```text
RESEARCH_SERVICE_ENABLED=1
RESEARCH_SWARM_ENABLED=1
RESEARCH_SWARM_PRESETS_ENABLED=1
```

They default to disabled. The two swarm flags also gate the Research Service. The internal bearer remains server-only.

All internal endpoints require that bearer plus `X-AiChart-User-Id` and `X-AiChart-Request-Id`:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/internal/research/swarms` | Idempotent creation from a reviewed preset |
| GET | `/internal/research/swarms/{run_id}` | Tenant-scoped run |
| GET | `/internal/research/swarms/{run_id}/tasks` | Current task projections |
| GET | `/internal/research/swarms/{run_id}/events` | Append-only safe events |
| POST | `/internal/research/swarms/{run_id}/cancel` | Cooperative run cancellation |
| POST | `/internal/research/swarms/{run_id}/tasks/{task_id}/cancel` | Optional-task cancellation |
| GET | `/internal/research/swarms/{run_id}/artifacts` | Tenant/run artifact references |

The create body has no authoritative tenant field. Cross-tenant reads, cancellation, evidence, tasks, events, and artifacts use not-found semantics.

## Lifecycle, DAG, and partial results

Run states are `draft`, `queued`, `running`, `cancelling`, `cancelled`, `partially_completed`, `succeeded`, `failed`, and `timed_out`. Task states are `pending`, `blocked`, `ready`, `running`, `retry_wait`, `succeeded`, `failed`, `cancelled`, `skipped`, and `timed_out`.

Illegal transitions are rejected. Every transition updates its current projection and appends an event in one SQLite transaction. Task output is inserted before `succeeded`, so dependants never see success without its structured output.

Only server presets create tasks. Creation validates IDs, dependencies, cycles, deterministic order, count, depth, roles, skills, tools, timeouts, and budgets. Failed dependencies cause skip propagation. Synthesis waits for every non-synthesis task to become terminal. `partially_completed` requires sufficient required outputs and an explicitly unavailable optional section; missing sections remain limitations.

Presets choose fail-fast or partial policy. Fail-fast stops new work after required-task failure. Partial presets continue independent bounded tasks but still fail when required synthesis inputs are unavailable.

## Workers, cancellation, and budgets

The manager has a fixed run-worker pool and each run has a smaller approved concurrency cap. Tasks cannot create tasks. Workers are deterministic handler boundaries, not unrestricted ReAct loops. Retry requires both a retryable task and retryable error; cancellation, timeout, auth, validation, policy, and budget failures never retry.

Workers persist heartbeat. A missed heartbeat emits `heartbeat_missed`, cancels the coroutine, and fails it. Run timeout and shutdown cancel and await children. Cancellation is serialized with artifacts, preventing artifact or success writes after terminal cancellation.

Server maxima cover workers, tasks, depth, run/task timeout, tokens, cost, tool calls, artifact count/bytes, and progress events. Callers may request lower values only. Role budgets narrow the run again. Exhaustion emits `budget_exhausted`, stops new work, preserves completed outputs, and synthesizes only if policy permits.

## Grounding and synthesis

Outputs separate facts, calculations, inferences, hypotheses, limitations, and evidence references. Supported facts/calculations require tenant-valid evidence; unsupported statements use `insufficient_evidence`. Allowed references include canonical recommendation, trade, learning event, Trading DNA, Shadow recommendation, research job/artifact, dataset/strategy hash, backtest run, validation artifact, and market snapshot IDs.

Dependants receive bounded typed projections. Excess narrative is dropped without rewriting numeric values or evidence IDs. Synthesis organizes findings, conflicts, limitations, and further research. It cannot recalculate source metrics, invent evidence, hide disagreement, authorize trading, or store hidden reasoning.

## Persistence, artifacts, and rollback

The least-privilege SQLite file under the service work volume contains `research_swarm_runs`, `research_swarm_tasks`, `research_swarm_dependencies`, `research_swarm_events`, `research_swarm_outputs`, and `research_swarm_usage`. No AiChart application database credential or migration is used. Queued runs recover after restart; abandoned running work is terminalized with `SWARM_SERVICE_RESTARTED` rather than guessed successful.

The existing Artifact Store writes controlled, atomic, hashed tenant/run JSON. Phase 6 writes plan, graph, results, synthesis, evidence, limitations, usage, and progress timeline. No hidden reasoning or secrets are artifacts.

Rollback sets both swarm flags to `0` and restarts services. SQLite/artifact volumes remain for retention/audit; rollback never deletes them.

Known limitations: the Python service verifies evidence type/shape/declared owner but deliberately lacks broad AiChart DB credentials to re-query every canonical row; the initial deterministic worker consumes supplied evidence and service references rather than a general model tool loop; HTML/PDF renderers are deferred. Generic Phase 2/3 jobs and Swarm state use separate durable SQLite files on the same restricted work volume.
