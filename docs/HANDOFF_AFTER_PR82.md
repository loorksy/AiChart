# Handoff after PR #82

PR #82 merged as `35be3ab` and deployed to production on 2026-07-27. Execution
stayed off throughout; no broker order was placed.

This document lists what did **not** ship, so the next PR starts from facts
rather than from the audit's original wording — several findings turned out to
be real for different reasons than reported.

## Deferred work

| ID | Severity | Current state | Files | Tests required |
|---|---|---|---|---|
| **#10** | Partial | The parity **key** is fixed — observations now pair on symbol + interval + closed candle instead of a snapshot hash that could never collide. But only `/api/agent/market/analyze` records an observation. The MCP-hosted model writing its own plan through `create_recommendation` → `/api/agent/recommendation` records **none**, so that surface is still invisible to parity. | `web/src/lib/agent/parityLog.ts`, `web/src/app/api/agent/recommendation/route.ts` | A test that drives both producers and asserts a comparison row exists with `unexplained = 0`. |
| **#16** | Follow-up | Cost evidence reaches the model, the snapshot, net R and the drift trigger. Two consumers still lag: the MCP `run_market_analysis` response does not expose `cost_evidence`, and `tradingPlaybook` still reports a fallback-sourced spread as `unknown` rather than `warning` with its reason. | `mcp/src/tools/schemas/chartsSchemas.ts`, `web/src/lib/agent/trading/tradingPlaybook.ts` | Assert the MCP response carries the contract; assert a fallback rung reads as `warning`, not `unknown`. |
| **#3** | Design decision | Free-text `activationCondition` stays optional at the contract layer. The machine-checked half (`activationRule`) is now mandatory for conditional and anticipatory plans, which was the real gap. | — | None. Recorded as accepted. |
| **#18** | False positive | Field names are carried consistently across contracts. | — | None. |

## Notes for whoever picks this up

**The parity comparison had never produced a single row.** Its join key was a
SHA-256 of the whole frozen snapshot, which embeds live candles, the live spread
and per-run chart images — so two surfaces could not produce the same hash even
in principle. `materializeParityComparison` bailed on every request and the
diagnostics dashboard reported "all critical zero" from *zero comparisons*. The
key is fixed; the second producer is the remaining half.

**Two integration fixtures were time-dependent** and would fail or pass
depending on the wall clock: they seeded a weekday-only *daily* candle series,
which reads as roughly 28% of calendar days missing, so the data-coverage check
could classify the fixture as an outage and return an operational blocker
instead of a decision. Their daily seeds are contiguous now
(`paritySurfaces.integration.test.ts`, `reevaluationEndToEnd.test.ts`). If
another suite starts failing intermittently around market data, check this
pattern first.

**A latent unit error was removed, not just avoided.** `market.spread` is in
price units and was being passed as `expectedSpreadFor`'s pips argument — an
error of roughly 10⁴ that stayed invisible only because the value was always
null. Wiring a real spread through would have activated it. Every key in the
cost contract now names its unit; there is deliberately no field called
`spread`.

**`AUTO_EXECUTION_STAGE` is now explicit in `web/.env`.** It was previously
absent, relying on `autoExecutionStage()` failing closed. It still fails closed,
but the value is written down so the state is auditable rather than inferred.
