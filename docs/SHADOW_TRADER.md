# Shadow Trader

Shadow Trader is a deterministic research-only observer. It generates shadow
recommendations but can never submit or manage a trade.

## Inputs

- canonical recommendations;
- immutable trade outcomes and learning events;
- historical real trades linked to canonical recommendation IDs;
- validated Trade Lessons;
- a versioned Trading DNA snapshot/persona;
- tenant-verified successful Research Service backtest references.

The latest eligible canonical recommendation is the research baseline. When no
eligible baseline exists, at least three completed historical observations and
a deterministic direction margin are required; otherwise the result is
`wait`. Real-trade results and validated lessons can adjust confidence only
within bounded limits. A successful backtest reference is evidence of a
completed research job, but Shadow Trader does not infer metrics that the
Research Service has not exposed.

## Output contract

A shadow recommendation contains:

- `buy`, `sell` or `wait`;
- confidence and bounded rationale;
- Trading DNA snapshot ID;
- optional canonical source recommendation ID;
- evidence references;
- immutable `researchOnly: true` and `executionProhibited: true` markers.

It deliberately contains no order size, notional, entry command, broker,
account, credentials, execution intent or approval payload.

## Security

- No imports from broker adapters, trade flow, execution tools or live guards.
- No `createIntent`, `recordTrade`, arbitrary HTTP, shell, generated Python,
  dynamic import or filesystem execution.
- Storage constraints require both research-only flags to remain enabled.
- All reads and replay are tenant scoped.
- Public routes expose only `GET` list and replay operations.
- Research Service remains isolated and independently authenticated.

## Replay

Shadow replay loads the exact immutable DNA snapshot/persona and merges the
shadow creation event with canonical replay. Canonical replay already includes
history, transitions, trade outcomes and learning events. This provides an
auditable chronology without storing hidden reasoning.

Read-only routes:

- `GET /api/shadow-trader`
- `GET /api/shadow-trader/{id}/replay`

Internal generation uses `generateShadowRecommendation()` and persists only a
non-executable research observation.
