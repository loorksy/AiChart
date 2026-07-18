# Complete Trade Candidate System Removal

**Branch:** `fix/candidate-free-model-authority`
**Actual PR base:** `d995fdf52ab2983bc116407999777048ee9396e8`
**Implementation commit:** `690d7df37ff07b2766ae5aea6d74a5bd976af888`
**PR head (pre-completion):** `2b9a8efcd1d03dcf91717205a3aea2e7473d3b2a`
**PR:** https://github.com/loorksy/AiChart/pull/66
**Completion pass (2026-07-19):** blockers below addressed in working tree / follow-up commit on `fix/candidate-free-model-authority`.
**Verified release status:** still **NO-GO** until GitHub CI, PR review, browser qualification, and exact-commit deploy gates pass.

## 1. Previous candidate architecture

Market evidence â†’ `buildTradeCandidates` / `scorePoi` / `runTradingPlaybook` â†’ `runRiskAgent` â†’ `runFinalDecisionSynthesizer` (bind `selectedTradeCandidateId`) â†’ recommendation / drawings / persistence.

Dual mode via `MODEL_FIRST_MODE` (`live` | `shadow` | `off`) could reactivate the candidate engine.

## 2â€“10. Deleted modules, types, schemas, APIs

| Deleted | Role |
|---|---|
| `web/src/lib/agent/trading/buildTradeCandidates.ts` | Trade proposal builder |
| `web/src/lib/agent/trading/scorePoi.ts` | POI / setup scorer |
| `web/src/lib/agent/trading/tradingPlaybook.ts` | Directional playbook gate |
| `web/src/lib/agent/trading/chartDrawingZones.ts` | User-drawing â†’ trade zone converter |
| `web/src/lib/agent/agents/riskAgent.ts` | Pre-decision analytical Risk Agent |
| `web/src/lib/agent/agents/finalDecisionSynthesizer.ts` | Candidate-binding synthesizer |
| Candidate-focused tests | `tradeBrain`, `tradingPlaybook`, `finalDecisionSynthesizer`, `chartDrawingZones` |

Deleted runtime concepts: `TradeCandidate`, `selectedTradeCandidateId`, `candidatesResult`, `selectedCandidate`, `runRiskAgent`, `MODEL_FIRST_MODE`, `getModelFirstMode`.

## 11. Risk Agent responsibilities

| Before | After |
|---|---|
| Build / select / rank trade proposals | **Deleted** |
| Propose WAIT when no candidate | **Deleted** |
| Account snapshot type | Moved to `accountRiskSnapshot.ts` (post-decision only) |
| Spread / news / quote facts | Remain as neutral evidence via market/news agents |

## 12â€“13. Runtime flags and fallbacks removed

- No `MODEL_FIRST_MODE` / shadow / off / legacy live toggle.
- Model timeout / invalid JSON / missing data â†’ technical decisions (`model_timeout`, `invalid_model_output`, `data_unavailable`, â€¦) â€” **never WAIT**.
- No candidate-engine fallback under any failure.

## 14. Final free-model architecture

```
User-selected symbol + timeframe
â†’ immutable snapshot + raw OHLCV + neutral facts + Vision
â†’ selected model (Responses Structured Outputs)
â†’ BUY | SELL | WAIT + model-owned plan
â†’ validateModelTradePlan
â†’ one repair pass (direction locked)
â†’ Risk per Trade sizing + explicit approval + broker guards
â†’ execution
```

## 15â€“16. Model I/O

- **Input:** `NeutralMarketEvidence` (candles, quote, structure facts, S/D locations as facts, news metadata, Vision metas). Leak detector blocks proposal authority keys.
- **Output:** `ModelTradePlan` (`decision`, `activation`, `marketRegime`, thesis, timeframe analysis, entry zone, invalidation, stop, targets, confirmation, path, alternative, confidence, summary, â€¦). No candidate ID fields.

## 17â€“18. WAIT and technical errors

- **WAIT** only when the model successfully returns `decision: "wait"`.
- Technical states: `data_unavailable`, `model_unavailable`, `model_timeout`, `invalid_model_output`, `analysis_failed`, `execution_unavailable`, `reanalysis_required`.

## 19â€“20. Validator and repair

- `validateModelTradePlan` (alias of technical validator): geometry / freshness / tick alignment only; **never** changes direction.
- One repair pass with technical errors only; direction immutable; failed repair keeps BUY/SELL with `executionReadiness: technically_unavailable`.

## 21â€“22. Platform + MCP

- Platform primary timeframe remains user-selected chart TF; context TFs are evidence.
- MCP skill search found no trade-candidate binding instructions in trading skills.
- Neutral market shortlists for discovery remain allowed; they must not pre-decide BUY/SELL levels.

## 23â€“24. Persistence / history

- New recommendations persist a versioned `context_json` envelope (`kind=model_owned_plan`)
  via `modelPlanPersistence.ts` with decision, activation, regime, thesis, entry zone,
  preferred entry, invalidation, stop, targets+reasons, confirmation, path, alternative,
  confidence, model ID, reasoning effort, snapshot ID/fingerprint, quote provenance,
  timeframes, validation state/errors, execution readiness, repair result, and safe provenance.
- Executable columns receive levels only when `validateModelTradePlan` accepts them.
- New recommendations no longer populate `poi` / `poi.score`.
- Historical rows remain readable via `mapHistoricalRecommendationContext` (including old
  Candidate-backed `risk.poi.score` rows).
- Rollback for the envelope: `UPDATE recommendations SET context_json = NULL WHERE â€¦ kind=model_owned_plan`
  (documented on the existing `context_json` column migration comments).

## 25â€“26. Architecture tests

- `freeModelAuthority.test.ts`: repository scan + decision-distribution fixtures.
- `integrationBoundaries.test.ts`: orchestrator must not import Risk Agent / candidate builders / dual mode.
- Model-first / drawing / evaluation tests updated.

## 27â€“30. Delivery status

| Item | Value |
|---|---|
| PR | https://github.com/loorksy/AiChart/pull/66 |
| Implementation commit | `690d7df` |
| CI | Failed: Web checks and MCP checks did not start because the GitHub account is billing-locked |
| Merge commit | Not yet |
| Deployed commit | Not yet (do not deploy until PR review GO) |
| Rollback | `git revert <merge>` or redeploy previous `d995fdf` |

## Preservation matrix

| Feature | Previous Candidate dependency | Replacement | Tests |
|---|---|---|---|
| Market analysis | Risk Agent + candidates + synthesizer | `runModelFirstDecision` | freeModelAuthority, safetyContracts |
| Recommendation drawings | POI / selectedCandidate | `buildDrawingsFromValidatedModelPlan` / model entry zone in `buildDrawingPlan` | buildDrawingPlan, freeModelAuthority |
| Recommendation persistence | `risk.selectedCandidate` | Partial model recommendation mapping; full plan/provenance not persisted | canonical/tracker tests only |
| Deep analysis enqueue | candidate POI type | Model direction â†’ demand/supply | orchestrator |
| Execution approval | Candidate levels | Model recommendation levels | execution guard unchanged |
| Historical replay | `buildTradeCandidates` action | Neutral market facts only | evaluation.test |
| Chart / MT5 / MCP / voice / subs | N/A | Untouched | existing suites |

## Explicit answers

| Question | Answer |
|---|---|
| Active `TradeCandidate` type? | **No** |
| Active builder / selector / ranker / binder? | **No** |
| New recommendation requires candidate ID? | **No** |
| Drawings / execution require candidate ID? | **No** |
| Prompt mentions candidates? | **No** |
| Env flag can reactivate candidates? | **No** |
| Fallback can call candidate engine? | **No** |
| Dual analytical architecture? | **No** |
| Model receives only neutral evidence? | **Yes** |
| Model independently chooses BUY/SELL/WAIT + levels? | **Yes** |
| WAIT only from successful model decision? | **Yes** |
| Technical failure / conditional â†’ WAIT? | **No** |
| Validator can change direction? | **No** |
| Platform TF still binding? | **Yes** |
| MCP host still free? | **Partial** â€” no candidate binding in trading skills, but schema drift and direct recommendation validation remain open |
| Exact candidate-free commit in production? | **Not yet** â€” deploy only after reviewed merge |

## GO / NO-GO

**NO-GO.** PR #66 is open, unreviewed, and red. Production remains unchanged on
`d995fdf52ab2983bc116407999777048ee9396e8`.

## Verified release-readiness audit (2026-07-19)

### GitHub and production

| Evidence | Verified result |
|---|---|
| Exact PR head | `2b9a8ef...` â€” documentation-only follow-up |
| Actual implementation | `690d7df...` |
| Actual base / `origin/main` | `d995fdf...` |
| PR state | OPEN, non-draft, `UNSTABLE` |
| Reviews | None; no requested reviewers or review threads |
| CI | Web and MCP checks failed before any steps; billing-lock annotation |
| Production web | Healthy, version 1.2.0, commit `d995fdf...` |
| Production MCP | Healthy, version 1.1.1, commit `d995fdf...`, OAuth |
| Production readiness | DB true, Redis ok |
| Corrective commit deployed | No |
| Rollback target | `d995fdf...`; no rollback commit exists |

### What is fully removed from unified market analysis

- Deleted: `buildTradeCandidates.ts`, `scorePoi.ts`, `tradingPlaybook.ts`,
  `chartDrawingZones.ts`, `riskAgent.ts`, `finalDecisionSynthesizer.ts`.
- Deleted/replaced: principal Candidate fixtures and tests.
- Removed: `MODEL_FIRST_MODE`, shadow/off legacy branch, selected Candidate ID binding,
  and Candidate-engine failure fallback.
- Verified: `runUnifiedChartAgent` now calls neutral evidence â†’ selected model â†’
  `validateModelTradePlan` â†’ at most one repair pass. Timeout and invalid model output
  are technical outcomes, not WAIT.

### Remaining Candidate references

Repository-wide search still found active Candidate terminology and behavior:

| Area | Active references | Assessment |
|---|---|---|
| Neutral opportunity scanner | `OpportunityCandidate`, `candidates`, score/sort/top in `monitor.ts` and `opportunityScan.ts` | No side/levels, but violates literal complete-domain removal |
| Recommendation context | local `candidate`/`candidates` in chat stream | Existing recommendation selection, not trade proposal |
| Post-model research | `actionableCandidate` in orchestrator/research evidence | Cannot alter the already-made decision, but terminology remains |
| Trade Lessons / Gold learning | Candidate types, validation, DB tables/status | Historical learning domain, not new trade proposal; not isolated by this PR |
| Trading DNA | Candidate locals over historical recommendations | Research-only by tests |
| Memory and skill selection | Candidate terms | Unrelated generic proposal/ranking domains |
| MCP UI | `data.candidates` compatibility and candidate labels | Active rendering compatibility |
| Tests/docs | Negative fixtures and historical descriptions | Safe and intentional |

The added architecture scan passes because it checks a narrow forbidden-token list; it
does not catch `OpportunityCandidate` or all active Candidate domains.

### Neutral input and model authority

The model receives snapshot identity, symbol, chart-bound primary timeframe, context
timeframes, bid/ask/mid/spread/quote age, raw bounded OHLCV envelopes and counts,
structure summary/latest event, liquidity count, nearest supply/demand facts, MTF
bias facts, news metadata, user-drawing summary, Vision metadata/images, and user
message. A leak detector blocks Candidate/proposed-trade/preferred-direction keys.

The payload is not yet the complete requested evidence contract: broker/source,
market quote timestamp, precision, tick size, market-open state, explicit ATR/
volatility, support/resistance arrays, full BOS/CHoCH history, and full liquidity
details are not all exposed directly in `NeutralMarketEvidence`.

The output schema is model-owned and contains decision, activation, market regime,
thesis, primary/context timeframe analysis, entry zone/preferred entry, invalidation,
stop, target prices/reasons, confirmation, path-to-entry, alternative scenario,
confidence, summary, reasons, warnings, and data timestamp. It contains no Candidate,
setup, or POI ID/rank/score.

### WAIT, validator, and repair

| Condition | Public/final behavior |
|---|---|
| Successful model WAIT | `wait` |
| Timeout | `model_timeout` |
| Invalid/empty output | `invalid_model_output` |
| Model/provider unavailable | `model_unavailable` |
| Cancelled request | `analysis_failed` |
| Missing/stale required data | `data_unavailable` |
| Missing Vision + sufficient candles | Continue numeric analysis |
| Invalid BUY/SELL levels | Preserve direction; execution unavailable |
| Failed repair | Preserve first direction; execution unavailable |

The validator runs after the model and checks level presence/order, side geometry,
target ordering, tick alignment, quote age, and immediate-price distance. Broker
minimum stops, spread, account ownership, session, connection, permission,
idempotency, and duplicate prevention are later execution checks. The validator
cannot choose or change direction.

One repair call is the maximum. It reuses the same model, reasoning effort, evidence,
images, and `store:false`; it sends technical error identifiers and no replacement
Candidate/POI/levels. Direction is hard-locked.

### Drawings and persistence defects

`buildDrawingsFromValidatedModelPlan` is the unified new-analysis drawing source and
has no Candidate/POI input. It uses model-owned levels. However, when execution is
not ready it can fall back to non-null raw plan levels and draw technically invalid
levels.

`storeFinalRecommendation` only persists executable BUY/SELL results. It does not
require Candidate IDs, but the full output plan/provenance is not persisted and the
in-memory `poi.score` compatibility field is populated for new recommendations.

### MCP

`run_market_analysis` reaches the same unified model-first platform path. The trading
skill states that the host model is the sole decision authority. `scan_market`
returns bounded `screeningItems` with symbol, interval, activity score, neutral
evidence, summary, and price; it returns no BUY/SELL/entry/stop/target. Internally it
still uses `OpportunityCandidate`. `create_recommendation` accepts a host-model plan
without Candidate binding, but does not call `validateModelTradePlan`.

MCP typecheck and 70 catalog tests passed. `schemas:check` failed because
`manifest.json` and `scan_market` generated contracts drifted. No authenticated MCP
PR-head run was completed.

### Exact validation outcomes

| Check | Outcome |
|---|---|
| Changed first-party lint | PASS: 0 errors, 1 warning |
| Whole web lint | FAIL: 23 errors, 156 warnings |
| TypeScript | PASS |
| Working-copy production build | PASS, two NFT warnings |
| Clean-clone build | FAIL: licensed TradingView module not provisioned |
| Full web test matrix | PASS with one real Redis round-trip skipped |
| Model-first suite | PASS: 34/34 |
| MCP catalog | PASS: 70/70 |
| MCP schema drift | FAIL |
| PostgreSQL release validator | Not run: `DATABASE_URL` absent |
| Redis release validator | Not run: `REDIS_URL` absent |
| Provider release validator | FAIL overall: OpenAI/OANDA pass, EA probe user absent |
| Browser/accessibility on PR head | Not verified; automated browser task was blocked before testing by an unpaid Cursor invoice |
| Git whitespace | FAIL: four report trailing-space lines before this update |
| Secret scan | Partial: gitleaks unavailable; redacted pattern scan found zero |
| Working tree baseline | `.cursor/` untracked and not ignored |

### Release blockers

1. Resolve/rename or explicitly isolate all active Candidate domains and expand the
   architecture scan.
2. Add full model-plan/provenance persistence, migration, rollback, and historical
   compatibility evidence.
3. Prevent invalid model levels from being drawn.
4. Validate MCP host-model recommendations and regenerate schemas/contracts.
5. Restore GitHub billing/CI and rerun Web/MCP jobs on the final SHA.
6. Obtain review approval.
7. Make the required lint baseline green.
8. Run authenticated PostgreSQL, Redis, MCP, browser/accessibility, historical-row,
   and security qualification.
9. Produce an exact merge commit, deploy it, and verify web/MCP health report that
   exact commit.

Detailed changed-file, test, decision-fixture, security, deployment, and 41-question
evidence is recorded in `docs/CANDIDATE_REMOVAL_RELEASE_EVIDENCE.md`.

## Completion pass (2026-07-19) â€” code blockers closed; release gates still open

The following audit blockers were fixed on `fix/candidate-free-model-authority`
(this completion commit). Historical claims above remain as audit trail.

| Blocker | Status after completion pass |
|---|---|
| `OpportunityCandidate` / scan auto top-pick | **Fixed** â€” `MarketScreeningItem` + `screeningItems`; deep scan supplies full shortlist to the model |
| Recommendation-context / research Candidate names | **Fixed** â€” `recommendationSources`, `actionableDecision` |
| Architecture scan misses screening authority | **Expanded** â€” prohibits `OpportunityCandidate` and authority-leak patterns |
| Incomplete model-plan persistence / `poi.score` | **Fixed** â€” `modelPlanPersistence` envelope; no new `poi`/`poi.score` |
| Draw invalid levels when not execution-ready | **Fixed** â€” drawings only when `executionReady`; note annotation otherwise |
| Incomplete `NeutralMarketEvidence` | **Fixed** â€” broker/source, quote timestamps, precision, tick, market-open, ATR, S/R, BOS/CHoCH, swings, sweeps, TF freshness |
| MCP `create_recommendation` validation + schema drift | **Fixed** â€” `validateModelTradePlan` + regenerated schemas/contract (`schemas:check` OK) |
| Missing decision fixtures | **Fixed** â€” stale quote/snapshot, vision, repair, cancel, unavailable, min-stop |
| Local model-first suite | **PASS** â€” 54/54 |
| MCP catalog | **PASS** â€” 70/70 |
| Web TypeScript | **PASS** |
| GitHub CI / PR review / browser / deploy | **Still open** â€” billing-locked CI; no review; no browser qualification; production unchanged |

**Rollback target:** `d995fdf52ab2983bc116407999777048ee9396e8`

**Final decision:** **NO-GO** (code blockers for the listed Critical items are addressed locally; required release gates are not all verified).
