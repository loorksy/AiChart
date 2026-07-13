# Canonical Recommendation Lifecycle

## Authority

`recommendations.id` is the only recommendation identity and
`recommendations.status` is the only current-state authority. The existing numeric identity was
kept because trade intents, executions, chart capture and MCP already reference it. Phase 4 does
not introduce a parallel root entity.

The canonical projection contains analysis, session, chat and tenant identity; symbol, market and
timeframe; direction and entry/stop/targets; bounded risk metadata; confidence; strategy and engine
versions; creation/expiry; status/reason; and source. `targets_json` and `risk_json` preserve the
typed multi-target/risk contract while legacy `take_profit` remains a first-target projection.

## State machine

The exact states are:

```text
draft -> active -> triggered -> partially_closed -> tp_hit
  |        |          |                 |
  |        +----------+-----------------+-> sl_hit | expired | cancelled | invalidated
  |                   +-------------------> closed (manual/partial close)
  +---------------------------------------> cancelled | invalidated
```

`tp_hit`, `sl_hit`, `expired`, `cancelled`, `invalidated` and `closed` are terminal. A caller cannot
skip a required intermediate state, return to an earlier state, or overwrite a terminal state.
Every accepted transition records the previous/current status, timestamp, trigger, actor, source,
reason and bounded structured metadata. An optimistic current-status predicate rejects concurrent
state changes rather than silently losing one.

## Append-only evidence

The current projection is intentionally mutable; evidence is not:

- `recommendation_history`: creation, safe updates and drawing snapshots.
- `recommendation_transitions`: the state-machine journal.
- `recommendation_outcomes`: TP1/2/3, SL, break-even, trailing, manual close, expiry,
  cancellation and invalidation plus R/PnL/holding/MAE/MFE/cost/risk evidence.
- `recommendation_learning_events`: deterministic events derived from outcomes.

Application code exposes append/list operations only. SQLite and PostgreSQL both install
`BEFORE UPDATE` guards on these four tables. Evidence can still be deleted by an explicit
tenant/account erasure cascade; immutability does not defeat privacy deletion.

Replay merges history, transitions, outcomes and learning events by timestamp and stable sequence.
It reconstructs creation, safe field updates, drawing snapshots, status and outcome evidence. It
does not store hidden reasoning or allow model text to replace previous evidence.

## Adapters and migration

- `saveRecommendation()` creates the canonical entity and keeps the old `Recommendation` return
  shape as a projection.
- `recommendationStore.ts` maps tracker cards and the deterministic Candle Warehouse sweep to the
  canonical lifecycle/outcome APIs. It never uses the old table as current authority.
- `sessionRecommendation.ts` is a rebuildable in-process cache. Tenant-owned changes are written
  through the canonical tracker adapter; a cache miss is hydrated from canonical persistence.
- Chart and agent-result recommendation objects are display projections. They cannot mutate
  canonical evidence.
- Context resolution keeps its existing `canonical > session > chart > history` precedence.

The legacy `tracked_recommendations` table is retained to avoid destructive migration. On first
owner/global tracker access, rows without a matching `(user_id, legacy_tracking_id)` are imported
in stable order. Import creates canonical history/outcomes/events and is idempotent. New code never
writes legacy rows. After operators verify the canonical row/event counts and retain a backup, the
legacy table may be archived in a later explicit migration; Phase 4 does not delete it.

Schema changes are additive on both backends and preserve existing data. Rollback is operational:
deploying the previous application ignores the new columns/tables, while removal of Phase 4 schema
objects must be a separate reviewed migration after backup. No destructive rollback runs
automatically.

## Server boundaries

Authenticated owner-scoped reads are available for tracker projections, canonical analytics and
replay. Browser POST/PUT/PATCH/DELETE routes for recommendation creation, status refresh, sweep and
cancellation do not exist. The deterministic sweep remains server driven by the existing
secret-authenticated cron route. Agent cancellation is an authenticated server workflow.

Learning cannot import or call Risk Guard, Execution Guard, Market Sync Guard or broker execution.
Those guards remain unchanged and authoritative.
