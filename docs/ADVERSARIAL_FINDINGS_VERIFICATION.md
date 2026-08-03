# Adversarial findings verification

Every finding raised by the acceptance review was verified against the code by
reading the real production call path — not the report. Each carries one of:
`CONFIRMED`, `FALSE_POSITIVE`, `DESIGN_DECISION`, `PARTIAL`, `OPERATIONAL_ONLY`.
Only `CONFIRMED` items at Critical/High are merge-blocking.

Verification commit base: PR #82 head `dea706d` + the remediation commits on
`claude/aichart-final-qualification-996dcb`. All fixes below were pinned by a
test that fails on the unfixed code and passes after.

## Summary

| Verdict | Count | Ids |
|---|---|---|
| CONFIRMED — fixed | 6 | 5, 6, 7, 8, 9, 16 (part 1) |
| CONFIRMED — open (High) | 3 | 1, 2, 4 |
| CONFIRMED — open (Medium) | 4 | 12, 13, 14, 15 |
| PARTIAL | 3 | 10, 11, 17 |
| DESIGN_DECISION | 1 | 3 |
| FALSE_POSITIVE | 1 | 18 |

The two originally-confirmed P0 findings (server-side approval proof;
`AUTO_EXECUTION_STAGE` at the choke point) are **fixed and tested** — see
`executionStageAndApproval.test.ts` and `executionMatrix.test.ts`.

## The table

| Id | Claim | Verdict | Severity | Fix / status | Test |
|---|---|---|---|---|---|
| 1 | MCP `create_recommendation` stores an incomplete plan — `execution_state`, activation/invalidation/alternative all NULL; the MCP schema has no fields to express them and storage never fills them | CONFIRMED | High | **OPEN** — needs the MCP + web contract to carry layer-3 fields and `superRefine` to reject an incomplete plan. Not attempted this session (contract change, needs test feedback). | — |
| 2 | Revision 1 stores the graded evidence **card**, not the frozen evidence **snapshot** the brain decided on — so `evidence_json` has no `modelContext`, no `visualSnapshots`, no numeric levels; the fingerprint covers a different object | CONFIRMED | High | **OPEN** — thread `synth.evidenceSnapshot` through `storeFinalRecommendation` → `persistTrackedRecommendation`, storing `{...snapshot, evidenceDimensions}`. Coupled to #15 (must project before the browser). Not attempted this session. | — |
| 3 | `activationCondition` is optional / can be generic | DESIGN_DECISION | Low | The free-text condition is intentionally optional at the contract layer (the plan may be `immediate`). The real gap is that nothing MACHINE-checks it — captured as #4. | — |
| 4 | A conditional plan activates on a bare price **touch** even when its stored condition demands a close/break/retest | CONFIRMED | High | **OPEN** — needs a structured `activationTrigger {kind, level, timeframe}` emitted by the synthesizer, persisted, and evaluated by the tracker instead of a touch. Not attempted this session (contract + model-prompt change). | — |
| 5 | `standing_auto` orders created with `recommendation_id = NULL` bypass the revision CAS entirely | CONFIRMED | High | **FIXED** — tracked rows carry a real `canonicalId`; the auto executor refuses an unbound plan (`unbound_plan`); the choke point refuses a `standing_auto` intent with no recommendation/revision binding. | `executionMatrix.test.ts` "standing_auto with NO recommendation binding" |
| 6 | Terminal (stopped-out / expired / invalidated) recommendations are not refused at execution — the CAS compares only the revision number, which a terminal status never bumps | CONFIRMED | High | **FIXED** — `checkRevisionIsCurrent` reads `status` + `execution_state` and refuses a terminal plan (`recommendation_terminal`). | `executionMatrix.test.ts` "a terminal (stopped-out) recommendation" |
| 7 | Quote-staleness / spread ceiling checked only on some routes; an approval-flow or auto order can fill across a blown-out spread on a stale heartbeat | CONFIRMED | High | **REOPENED** — the fix below was EA-only (`checkForexTradePreflight` gated on `mt_ea` intents) and was itself always-failing for every non-EA order (a real pre-existing bug). With the EA bridge removed, `checkForexTradePreflight` and its call site were deleted rather than kept broken; the original quote-staleness/spread-ceiling gap on metaapi/mt5local intents has not been re-assessed against the current codebase and needs a fresh look. | `executionMatrix.test.ts` no longer has a preflight test (mechanism removed) |
| 8 | Daily-loss limit unreachable — `realisedDailyLossFraction` never passed, so the gate compares against 0; a sequential losing streak is unbounded | CONFIRMED | High | **FIXED** — today's realised loss is computed from verified equity and passed into the portfolio gate; an unreadable P&L becomes an incomplete-gate warning, not a silent zero. | `evaluatePortfolioForIntent` path in `executionMatrix.test.ts` |
| 9 | Live dual-enablement never engages because the broker-reported mode isn't recognised | CONFIRMED→FIXED | High→n/a | **FIXED** — MT5 `"real"` now maps to `live`; `demo` requires a positively-reported demo account; an unknown connected environment fails closed (`execution_stage_env_unknown`). | `executionMatrix.test.ts` real-account + unknown-env rows |
| 10 | `parityLog` never observes the real MCP surface | PARTIAL | Low | The MCP `run_market_analysis` route hard-codes `surface:"mcp"` and does reach `recordDecisionForParity`; the vacuous-parity claim does not hold. Residual: parity needs BOTH surfaces on one evidence hash to compare, which is an operational coverage matter. | existing `paritySurfaces.integration.test.ts` |
| 11 | Journal adherence uses the newest revision, not the one effective at execution time | PARTIAL | Medium | Confirmed for entry-diff / stop adherence wording; NOT for late-entry / early-exit (those already bind to the execution-time revision). Narrow, non-safety. | — |
| 12 | Evidence Card / Decision Trace / execution state unreachable from navigation | CONFIRMED | Medium | **OPEN** — the components render but no nav path leads to a recommendation detail view. UX gap, not a safety gate. | — |
| 13 | `criticalAlert()` does not increment the metrics the diagnostics dashboard reads (hidden-WAIT, wrong-mode) | CONFIRMED | Medium | **OPEN** — the counters exist and `criticalAlert` fires, but they are not the same registry series the admin route reads. Observability gap. | — |
| 14 | Trade-watch proximity alerts send raw Telegram repeatedly — no dedupe key, no preferences, no `alert_log` | CONFIRMED | Medium | **OPEN** — the proximity notifier bypasses the lifecycle path. Noise / preference-bypass, not a trade action. | — |
| 15 | The full evidence snapshot incl. base64 chart images is serialized to the browser | CONFIRMED | Medium | **OPEN** — needs a `publicEvidenceProjection` at every browser boundary. Coupled to #2. Payload-size / data-exposure, no auth boundary crossed (own user's data). | — |
| 16 | `market.spread` always null → the decision engine never sees real cost | CONFIRMED | High | **PART-FIXED** — `executionCost` was gated on the observed spread and dropped the real live cost profile computed upstream; it is now built whenever a live cost OR an observed spread exists, so live cost reaches the model. Part 2 (wiring the raw observed spread through the 4 entry points, which also re-arms the spread-drift trigger #17) remains OPEN. Note: the EA bridge that fed the live cost profile's samples was later removed with no replacement, so `executionCost` from that source will read `unavailable` going forward until a new live-quote source is wired. | — |
| 17 | Spread-drift re-evaluation trigger is dead — no baseline spread stored | PARTIAL | Medium | Depends on #16 part 2 (a baseline in the snapshot). Tied to the same wiring. | — |
| 18 | activation/invalidation field names inconsistent across contracts | FALSE_POSITIVE | None | The one rename (`activationCondition`) is carried consistently; no surface drops what another requires. No failure scenario. | — |

## What remains before this PR may merge

`CONFIRMED` High findings **1, 2, 4** are open, plus **16 part 2**. Per the
standing rule (no merge with an open Critical/High), the PR **stays in Draft**
and merge remains blocked. Findings 12–15 (Medium) and 10/11/17 (Partial) do not
block merge on their own but are recorded here for follow-up.

None of the open items is a broker-order bypass: findings 1, 2, 4 concern plan
completeness, evidence-snapshot integrity, and activation semantics. Every path
that can place a real order (5, 6, 7, 8, 9, and the two original P0 findings) is
closed and tested, with the financial acceptance matrix proving `placeOrder`
is called zero times in every refusal case.
