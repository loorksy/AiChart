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
