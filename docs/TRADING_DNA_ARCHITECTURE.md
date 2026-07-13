# Trading DNA Architecture

## Scope

Phase 5 adds a tenant-scoped, research-only behavioural layer over data that
AiChart already owns. It does not create a second recommendation lifecycle,
trade journal, backtest engine, memory store, execution path, or research
runtime. Phase 6 swarm concepts are out of scope.

## Existing sources of truth

| Evidence | Existing authority | Phase 5 use |
| --- | --- | --- |
| Recommendations | `recommendations` and canonical lifecycle tables | Identity, strategy, confidence, symbol, timeframe, status and replay |
| Outcomes | `recommendation_outcomes` | R multiple, holding time, MAE, MFE, costs, risk used and exit behaviour |
| Learning | `recommendation_learning_events` | Outcome classification and evidence provenance |
| Real trades | `trades` joined through `trade_intents.recommendation_id` | Real execution count, PnL and recommendation linkage |
| Trade Lessons | Validated `trade_lesson_candidates` | Reviewed behavioural/strategy evidence only |
| Gold learning | `gold_agent_weight_versions` | Version history only; Phase 5 never mutates live weights |
| Agent trace | `agent_runs`, `agent_run_steps`, `agent_tool_calls` | Safe run provenance; never hidden reasoning |
| Backtests | Isolated Research Service jobs and artifacts | Opaque tenant-verified job/artifact references; no engine duplication |

Missing values remain explicitly `insufficient_evidence`. Phase 5 never
estimates MAE, MFE, risk used, execution costs, holding time, or backtest
performance when the underlying fields are absent.

## Derived storage

Phase 5 adds only derived, versioned records:

- `trading_dna_snapshots`: immutable metrics, conclusions and their bounded
  evidence references.
- `trading_persona_versions`: immutable evidence-based persona versions.
- `shadow_recommendations`: immutable, research-only observations with no
  order size, broker, credentials, execution intent, or executable command.

PostgreSQL and SQLite schemas remain equivalent. Derived records are scoped by
`user_id`; reads require both the tenant and the record identifier. Source
records are never updated by Trading DNA or Shadow Trader.

## Evidence contract

Every supported metric, conclusion, persona and shadow recommendation carries
a bounded evidence set containing one or more of:

- canonical recommendation IDs;
- real trade IDs;
- recommendation learning-event IDs;
- Research Service backtest job IDs and artifact IDs.

An assertion with no valid evidence is rejected. References are deduplicated,
sorted deterministically and size limited. Backtest references are accepted
only after the Research Service confirms the job belongs to the same tenant,
has succeeded, and exposes the referenced artifacts. Artifact contents remain
inside the Research Service.

## Pipeline

1. The evidence collector reads tenant-scoped canonical recommendations,
   outcomes, learning events, real trades and validated Trade Lessons.
2. The metric engine calculates only fields supported by the collected rows.
3. The conclusion engine converts supported metrics into bounded public-safe
   strengths, weaknesses, patterns and suggestions with the same provenance.
4. The persona classifier creates a version only when minimum sample and
   dominance gates are satisfied; otherwise it returns `unclassified`.
5. The snapshot repository persists the immutable derived view.
6. The report renderer serializes the same snapshot to JSON, escaped HTML and
   a bounded PDF. It does not ask an LLM to invent conclusions.
7. Shadow Trader consumes the snapshot plus the same evidence bundle and may
   emit only `buy`, `sell`, or `wait` research observations. It cannot call a
   broker, execution guard, trade-intent writer, shell, Python, or arbitrary
   HTTP endpoint.
8. Replay merges the shadow record with the canonical recommendation replay;
   canonical replay already contains lifecycle transitions, outcomes and
   learning events.

## Behaviour metrics

The initial deterministic model supports risk tolerance, average R, holding
time, MAE, MFE, win/loss behaviour, session/symbol/timeframe preferences,
break-even and trailing behaviour, risk scaling, drawdown/recovery,
confidence calibration, execution consistency and concentration. Each metric
publishes its sample size, confidence, method and evidence. Minimum-sample
gates are metric-specific and are documented in `docs/TRADING_DNA.md`.

## Security invariants

- All queries are tenant scoped.
- Public application routes are read-only (`GET`).
- No broker credentials, private headers, raw prompts or hidden reasoning are
  stored in derived records or reports.
- Shadow recommendations are marked research-only and contain no execution
  payload.
- Research Service remains server-only, independently authenticated and
  feature-flagged.
- Phase 5 has no dependency on execution, broker adapters, shell, dynamic
  imports, unrestricted Python, Markdown memory, or swarm runtime modules.

## Vibe audit decision

- **Idea only:** evidence-backed behaviour profiles, counterfactual/shadow
  comparison, performance attribution and report/replay concepts.
- **Reimplemented:** immutable typed records, deterministic metrics and
  evidence-linked reports using AiChart's database and security boundaries.
- **Adapted:** the broad notion of a research-only shadow profile, narrowed to
  canonical Forex/XAUUSD evidence and no generated code.
- **Rejected:** generated Python signal engines, arbitrary execution,
  filesystem/Markdown memory, dynamic imports, shell access, unrestricted
  Python, factor zoo, cross-market baskets and unrelated market logic.
- **Deferred:** all swarm orchestration, worker/task graphs and research swarm
  presets (Phase 6 only).

No Vibe source code, formulas, tests, datasets, templates or report text are
copied into AiChart.
