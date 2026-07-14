# Vibe-Trading Attribution

The integration design was informed by the locally supplied Vibe-Trading source archive.

Vibe-Trading is distributed under the MIT License:

> Copyright (c) 2026 Vibe-Trading Contributors

Its NOTICE also attributes HKUDS contributors and identifies separately attributed factor definitions. No Vibe-Trading source file, factor formula, dataset, prose, table or figure has been copied into AiChart in the audit phase.

Current classification:

- Context management: idea only, reimplemented for AiChart's TypeScript agent.
- Skill and tool registries: architectural ideas, adapted to AiChart permissions and trust boundaries.
- Persistent Markdown memory: reviewed and rejected in favor of AiChart's tenant-scoped database and semantic memory.
- Backtest and validation: accepted as idea-only architecture and independently reimplemented for
  AiChart in Phase 3; no Vibe code transfer occurred. Shadow account and swarm remain deferred.
- Unrelated market loaders, arbitrary shell/Python execution and factor-zoo content: rejected.

Phase 1 classification update:

- Context compaction and tool-pair repair: Vibe-informed idea only; reimplemented in TypeScript.
- Persistent memory categories and recall: idea only; reimplemented on AiChart's existing PostgreSQL/SQLite stores. Markdown memory rejected.
- Skill Registry and lazy loading: idea only; reimplemented with AiChart trust and path controls. No Vibe skill body copied.
- Tool Registry: idea only; reimplemented with AiChart server permissions and safety classes.
- Run trace: idea only; reimplemented as redacted AiChart database records. Raw reasoning storage rejected.

Phase 2 classification update:

- Isolated research process, job lifecycle and artifact-reference concepts: idea only; independently reimplemented for AiChart in Python/FastAPI.
- No Vibe source, task implementation, strategy code, formula, schema, prose, or test was copied or substantially adapted.
- Arbitrary Python/shell execution and direct trading access remain explicitly rejected.

Phase 3 classification update:

| Area | Vibe provenance | AiChart classification |
|---|---|---|
| N-close/N+1-open timing and bar-by-bar policy separation | Idea only | Reimplemented for strict AiChart UTC/as-of semantics |
| Explicit spread/cost and same-candle policies | Idea only | Reimplemented for Forex/XAUUSD with registered metadata |
| Named Monte Carlo/bootstrap/walk-forward reporting | Idea only | Reimplemented with bounded local seeds and named assumptions |
| Descriptive metrics, attribution, and artifact-oriented evidence | Idea only | Reimplemented; causal claims rejected |
| Dynamic strategy modules/generated Python | Reviewed | Rejected |
| Arbitrary filesystem, DuckDB, network, or third-party dataset loaders | Reviewed | Rejected |
| Factor libraries and unrelated equity/futures/options/crypto engines | Reviewed | Deferred outside Phase 3 |
| Optimization and parameter search | Reviewed | Deferred; not implemented |

No Phase 3 file is classified as `adapted` or `copied with attribution`. No provable source-level
transfer occurred. The accepted concepts are attributed as idea-only; implementation was written
against AiChart's requirements and independently defined typed contracts. Vibe assumptions that
conflict with strict typing, point-in-time availability, Forex metadata, isolation, or
non-execution were rejected rather than carried forward.

Current classification totals:

- idea only: architectural/timing/validation concepts listed above;
- reimplemented: AiChart-specific clean implementations of accepted ideas;
- adapted: none from Vibe source;
- copied with attribution: none;
- rejected: dynamic execution, loose schemas, arbitrary I/O/network, guessed market behavior;
- deferred: unrelated engines, factor content, optimization, Shadow Trader, and swarm work.

If a later change copies or substantially adapts source, this file must list the source path, destination path, commit/archive identity, classification, and required copyright/license notice.

## Phase 4 classification update

The local archive was reviewed again before Phase 4. No Vibe source code, tests, formulas,
datasets, documentation or comments were copied or substantially adapted.

| Concept | Vibe area reviewed | Classification |
|---|---|---|
| Append-only structured trace/event ordering | `agent/src/agent/trace.py`, `loop.py` | idea only; independently reimplemented in AiChart database records |
| Replay from ordered public-safe evidence | agent trace/artifact flow | idea only; independently reimplemented with canonical history/transitions/outcomes/events |
| Evidence/artifact references instead of mutable prose | trace and backtest models | idea only; reimplemented with outcome IDs and bounded JSON evidence |
| Statistical sample/confidence gates | backtest metrics/validation | idea only; reimplemented without Vibe formulas |
| Version retention and rollback audit | trace/run history concepts | idea only; reimplemented for Gold Agent X weights |
| Markdown persistent memory | `agent/src/memory/persistent.py` | rejected |
| Arbitrary Python/shell and dynamic imports | agent tool/runtime paths | rejected |
| Generated Shadow Account code execution | `agent/src/shadow_account/` | rejected; Shadow Trader domain deferred to Phase 5 |
| Swarm agents, DAG execution and presets | `agent/src/swarm/` | deferred to Phase 6; unrelated presets rejected |
| Factor zoo, equities and crypto logic | backtest/factor/market material | rejected |

Phase 4 classification totals:

- idea only: append-only audit, replay, evidence references, statistical gates and version history;
- reimplemented: all accepted concepts as typed AiChart-native TypeScript/SQL contracts;
- adapted from Vibe: none;
- copied with attribution: none;
- rejected: Markdown memory, dynamic/local execution, generated code, factors and unrelated markets;
- deferred: Shadow Trader concepts to Phase 5 and swarm concepts to Phase 6.

## Phase 5 classification update

The archive was reviewed again before implementation, especially
`agent/src/shadow_account/`, `agent/src/swarm/`, `agent/src/memory/`,
`agent/src/agent/trace.py` and `agent/backtest/`.

| Concept | Classification | AiChart decision |
|---|---|---|
| Evidence-backed behaviour profile | idea only; adapted at the domain level | Reimplemented over canonical AiChart IDs and tenant SQL stores |
| Research-only shadow comparison | idea only; adapted at the domain level | Reimplemented as a non-executable immutable observation |
| Attribution, replay and report sections | idea only | Reimplemented with deterministic metrics and explicit provenance |
| Frozen/versioned profile contracts | idea only | Reimplemented as TypeScript snapshot/persona versions |
| Generated `signal_engine.py`, Jinja templates and run directories | rejected | No generated code or dynamic runtime |
| Multi-market liquid baskets and unrelated equity/crypto rules | rejected | Canonical AiChart Forex/XAUUSD evidence only |
| Markdown/YAML/file memory | rejected | Existing tenant-scoped database memory remains authoritative |
| Arbitrary shell/Python/dynamic import paths | rejected | No equivalent Phase 5 capability |
| Swarm workers, presets, DAG/task stores and agent aggregation | deferred to Phase 6 | No swarm source or architecture implemented in Phase 5 |

Phase 5 totals:

- idea only: behaviour profiles, research shadow comparison, attribution,
  replay, evidence and report organization;
- reimplemented: all accepted behaviour/evidence/persona/report contracts in
  AiChart TypeScript/SQL;
- adapted: the high-level Shadow Account domain concept only, narrowed to
  canonical tenant evidence and strict non-execution;
- copied with attribution: none;
- rejected: generated code, arbitrary runtimes, Markdown memory, unrelated
  markets/factors and unsupported inference;
- deferred: all swarm work to Phase 6.

No Vibe source, template, prose, formula, test, dataset or comment was copied or
substantially adapted in Phase 5.

## Phase 6 classification update

The local archive was inspected again before Phase 6, especially `agent/src/swarm/`, preset YAML,
`worker.py`, `runtime.py`, `models.py`, `task_store.py`, `store.py`, `grounding.py`, swarm API/tool
adapters, agent context/loop/trace/tools/skills, backtest material, and `shadow_account/`. Requested
swarm files `orchestrator.py`, `state.py`, and `storage.py` are absent; those responsibilities are
distributed across the listed files.

| Concept | Classification | Phase 6 decision |
| --- | --- | --- |
| DAG validation and dependency layers | idea only; reimplemented | Typed AiChart presets and deterministic order |
| Bounded workers, heartbeat, cancellation, retry | idea only; reimplemented | Independent asyncio/SQLite contracts |
| Upstream summaries and artifacts | idea only; reimplemented | Grounded typed outputs with strict caps |
| Grounded-data-first policy | adapted at architecture level | AiChart evidence IDs and `insufficient_evidence`; no loader/prose transfer |
| Roles and presets | idea only; reimplemented | Seven AiChart presets; no YAML copied |
| Markdown/JSON production state | rejected | Least-privilege SQLite and append-only events |
| ReAct/hidden reasoning | rejected | Public-safe deterministic handler outputs |
| Bash, generated Python, dynamic import, file tools | rejected | No equivalent capability |
| Arbitrary connectors, broker, MT5, execution | rejected | Closed research-only policy |
| Factor zoo, unrelated markets, shadow code generation | rejected | Outside Phase 6 |
| User DAGs and recursive spawning | deferred/rejected | Immutable presets only |

Phase 6 totals: accepted ideas were independently reimplemented; grounding alone was adapted at a
high-level architecture boundary; copied with attribution is none; arbitrary code/I/O/network,
file state, broker/MT5/execution, factors, and hidden reasoning were rejected; user DAGs, a general
LLM tool loop, HTML/PDF renderers, and unrelated connectors are deferred.

No Vibe source, test, comment, prompt, formula, template, preset, dataset, factor definition or
report prose was copied or substantially adapted in Phase 6.

## Production-hardening audit

The Vibe archive was reviewed again during release preparation across swarm, agent, memory,
backtest, shadow-account, README, and available documentation paths. No additional Vibe idea was
needed for the hardening changes. Durable generic job storage follows the already established
AiChart Swarm restart policy and was independently implemented against AiChart's typed job
contract. Secret cleanup, disabled Docker defaults, Redis persistence, readiness, and operational
backup/restore guidance are AiChart operational work rather than Vibe-derived architecture.

Classifications therefore remain unchanged: no copied source, tests, datasets, formulas, prompts,
Markdown memory, shell execution, generated Python, dynamic imports, or unrestricted filesystem or
network behavior was incorporated. File/Markdown state, ReAct loops, arbitrary tools, broker
execution, factor-zoo content, and hidden reasoning remain rejected.
