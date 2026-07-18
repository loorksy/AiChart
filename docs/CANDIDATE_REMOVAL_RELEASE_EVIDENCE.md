# Candidate System Removal â€” Implementation and Release Evidence

Audit date: 2026-07-19
Repository: `loorksy/AiChart`
Pull request: https://github.com/loorksy/AiChart/pull/66
Audited PR head: `2b9a8efcd1d03dcf91717205a3aea2e7473d3b2a`
Release decision: **NO-GO**

This document records repository, GitHub, test, runtime, and production evidence. It distinguishes verified behavior from unverified claims. No defect found during this audit was silently repaired.

## 1. Executive summary

The requested change was an architectural deletion of the Trade Candidate decision domain. The previous platform path generated and ranked deterministic trade proposals, selected one in the Risk Agent, and asked a synthesizer/model to bind its answer to a selected Candidate. The intended replacement is one model-first path: immutable evidence and neutral images go to the selected model; the model returns BUY, SELL, or WAIT and its own plan; deterministic code validates technical executability without rewriting direction.

PR #66 does delete the former core Trade Candidate engine and removes it from `runUnifiedChartAgent`: `buildTradeCandidates`, `scorePoi`, `tradingPlaybook`, `riskAgent`, `finalDecisionSynthesizer`, their principal tests, and `MODEL_FIRST_MODE` are absent from the PR-head runtime path. No import or fallback in the unified chart-analysis path can call those deleted modules.

The release is nevertheless incomplete:

1. Active runtime still contains Candidate-named domains and ranking/selection in `monitor.ts`, `opportunityScan.ts`, `researchEvidence.ts`, the chat recommendation resolver, Trading DNA, Trade Lesson learning, and MCP UI/skill internals. Most are not the deleted Trade Candidate engine, but the repository-wide â€œno active Candidate conceptsâ€‌ completion criterion is not met.
2. The broad scan is direction-neutral in its returned evidence, but it still defines `OpportunityCandidate`, stores `candidates`, sorts them by score, and selects `top`; the architecture scan test does not catch this.
3. New recommendation persistence does not store the full model-owned plan or required provenance. It loses the entry-zone object in canonical persistence, activation, thesis, path-to-entry, alternative scenario, confirmation, model ID, reasoning effort, snapshot ID/fingerprint, quote timestamp, context timeframes, validation errors/state, and execution-readiness state. It also populates the legacy in-memory `poi.score` from model confidence.
4. `buildDrawingsFromValidatedModelPlan` can draw non-null model levels even when `executionReady` is false; the levels are model-owned but not necessarily technically valid.
5. MCP `create_recommendation` persists host-supplied levels without calling `validateModelTradePlan`, and MCP generated schemas are stale for `scan_market`.
6. GitHub CI did not execute any steps. Both jobs failed before runner allocation because the account is locked for a billing issue.
7. The PR has no reviews. The only PR comment is a Codex review quota notice.
8. Whole-repository lint is red: 23 errors and 156 warnings. Changed first-party files have zero errors and one warning.
9. PostgreSQL and Redis release validators were not completed because local authenticated URLs were absent. The ordinary CI matrix skipped the real Redis round trip.
10. A clean-clone build fails until the licensed TradingView library is provisioned. GitHub CI, which contains that provisioning step, never ran.
11. The exact PR head was not browser-qualified or deployed. Production remains on the PR base commit.

Unrelated features have meaningful automated regression coverage and the local working-copy production build passed, but browser, authenticated MCP, PostgreSQL, Redis, historical-record, and full security qualification are incomplete. Therefore the final decision is **NO-GO**.

## 2. Git and repository baseline

| Item | Verified value |
|---|---|
| Repository | `loorksy/AiChart` |
| Default branch | `main` |
| Work branch | `fix/candidate-free-model-authority` |
| Actual PR base | `d995fdf52ab2983bc116407999777048ee9396e8` |
| Implementation commit | `690d7df37ff07b2766ae5aea6d74a5bd976af888` |
| Documentation follow-up / PR head | `2b9a8efcd1d03dcf91717205a3aea2e7473d3b2a` |
| PR | `#66`, open, non-draft, merge state `UNSTABLE` |
| Current `origin/main` | `d995fdf52ab2983bc116407999777048ee9396e8` |
| Branch pushed | Yes; local HEAD equals `origin/fix/candidate-free-model-authority` before this report edit |
| Branch protection | GitHub returned `404 Branch not protected`; no required-check policy was discoverable |
| Rollback commit | None exists; rollback target before merge is `d995fdf`; after merge, revert the merge commit |
| Corrective code in main | No |
| Corrective code in production | No |

The supplied references required correction:

- **YES**, `2b9a8ef` is the exact PR head, but it is a documentation-only follow-up, not the implementation commit.
- **NO**, `690d7df` is not the PR base. It is the implementation commit. The actual base is `d995fdf`.
- PR #66 contains two commits and 37 files: 1,152 additions and 3,264 deletions.
- No unrelated product change was identified in the PR file list. The execution-desk wording, UI technical states, localization, tests, and documentation are directly related to the refactor.
- The baseline working tree was not clean because `.cursor/` was untracked. `.cursor/` was not tracked and was also **not ignored**. This report adds/updates documentation in the working tree and is not committed by this audit.
- `git diff --check origin/main...HEAD` fails on four trailing-space lines in `docs/COMPLETE_CANDIDATE_SYSTEM_REMOVAL.md`.

## 3. Previous architecture

```text
Market data and deterministic detectors
â†’ POI scoring
â†’ buildTradeCandidates
â†’ candidate ranking / best selection
â†’ trading playbook
â†’ runRiskAgent
â†’ runFinalDecisionSynthesizer
â†’ model selects selectedTradeCandidateId
â†’ bind Candidate direction and levels
â†’ recommendation / drawings / persistence / execution preparation
```

`MODEL_FIRST_MODE=off|shadow|live` allowed dual behavior. Off/legacy could run the Candidate-first path, while shadow/live could execute model-first behavior alongside or instead of it. Candidate existence, score, quality, geometry, selected POI, and selected ID constrained what the model could return. The model was therefore not a free analytical authority: application code narrowed direction and levels before the final call and the synthesizer bound model output back to a generated object.

Former Candidate stages were:

- `scorePoi`: deterministic POI/setup scoring.
- `buildTradeCandidates`: BUY/SELL proposal construction, geometry, ranking, and â€œbestâ€‌.
- `runTradingPlaybook`: checklist/playbook gating.
- `runRiskAgent`: selected proposal and proposed trade before the model.
- `runFinalDecisionSynthesizer`: Candidate-aware prompt and `selectedTradeCandidateId` binding.
- `chartDrawingZones`: conversion of user drawings into detector trade zones.
- drawing and persistence code consuming `risk.selectedCandidate` / POI metadata.
- replay tests that re-ran the Candidate builder.
- `MODEL_FIRST_MODE` shadow/off fallback architecture.

## 4. Final active platform architecture

```text
User-selected chart symbol and primary timeframe
â†’ runUnifiedChartAgent
â†’ runMarketDataAgent / fresh context candles
â†’ buildMarketSnapshot
â†’ buildCandleEnvelope (raw bounded OHLCV)
â†’ structure/liquidity/supply-demand/MTF/news factual agents
â†’ captureNeutralDecisionCharts (+ optional labeled user-context image)
â†’ buildNeutralEvidence
â†’ runModelFirstDecision using selected registry model/reasoning
â†’ ModelTradePlan BUY | SELL | WAIT and model-owned levels
â†’ validateModelTradePlan
â†’ at most one repair call with direction locked
â†’ buildDrawingsFromValidatedModelPlan
â†’ storeFinalRecommendation when executable
â†’ runExecutionGuardAgent / explicit approval
â†’ trade-open preflight
â†’ getRiskBudget + computeForexLots
â†’ broker/EA execution safeguards
```

| Stage | Code |
|---|---|
| Chart-bound scope | `web/src/lib/agent/modelFirst/contextTimeframes.ts`: `platformChartBoundScope`, `resolveContextTimeframes` |
| Unified orchestration | `web/src/lib/agent/orchestrator.ts`: `runUnifiedChartAgent` |
| Live market context | `runMarketDataAgent`, `getFreshAgentCandles`, `resolveDecisionQuote` calls in `orchestrator.ts` |
| Immutable snapshot | `modelFirst/marketSnapshot.ts`: `buildMarketSnapshot` |
| Raw OHLCV envelope | `modelFirst/candleEnvelope.ts`: `buildCandleEnvelope` |
| Neutral facts | structure, liquidity, supply/demand, multi-timeframe, news agents; `buildNeutralEvidence` |
| Vision | `modelFirst/neutralVision.ts`: `captureNeutralDecisionCharts`, `captureUserContextChart` |
| Model call | `modelFirst/runModelFirstDecision.ts`; `openaiResponses.ts` |
| Output contract | `modelFirst/modelTradePlan.ts`: `ModelTradePlanSchema` |
| Technical validation | `modelFirst/validatedTradePlan.ts`: `validateModelTradePlan` |
| Repair | inner `once` call in `runModelFirstDecision`, guarded by one `if` |
| Drawings | `modelFirst/buildDrawingsFromValidatedModelPlan.ts` |
| Persistence | `orchestrator.ts`: `storeFinalRecommendation`, `persistTrackedRecommendation` |
| Approval | `agents/executionGuardAgent.ts`; approval routes |
| Sizing/execution | `execution.ts`, `brokers/lotSizing.ts`, bridge/broker preflight |

For the unified platform analysis path there is one active intelligence path. `MODEL_FIRST_MODE`, shadow mode, and off/legacy Candidate mode are removed from `orchestrator.ts`; no environment variable can reactivate the deleted engine; no fallback imports it. Separate research-only Shadow Trader and MCP host-model paths still exist and are not execution authority for `runUnifiedChartAgent`.

## 5. Deleted-components inventory

| Deleted/removed component | Previous purpose | Previous consumers | Replacement | Verification |
|---|---|---|---|---|
| `trading/buildTradeCandidates.ts` | Candidate types, construction, scoring, ranking, best proposal | Risk Agent, replay, tests | Model creates plan | Deleted in PR |
| `trading/scorePoi.ts` | POI score/grade | Candidate builder | Neutral zones are evidence | Deleted in PR |
| `trading/tradingPlaybook.ts` | Directional setup/checklist gate | Risk Agent | Strategy catalogue in model prompt/skill | Deleted in PR |
| `trading/chartDrawingZones.ts` | User drawing to detector POI | Candidate builder/tests | Labeled user-context Vision and drawing summary | Deleted in PR |
| `agents/riskAgent.ts` | Build/select/rank proposed trade before model | Orchestrator | Post-decision account/execution checks | Deleted in PR |
| `agents/finalDecisionSynthesizer.ts` | Candidate prompt, selected-ID validation and level binding | Orchestrator | `runModelFirstDecision` | Deleted in PR |
| `chartDrawingZones.test.ts` | Candidate drawing-zone tests | Test suite | Model drawing tests | Deleted |
| `finalDecisionSynthesizer.test.ts` | Candidate binding/fallback tests | Test suite | `freeModelAuthority.test.ts` | Deleted |
| `tradeBrain.test.ts` | Candidate builder/ranker tests | Test suite | Model authority and geometry tests | Deleted |
| `tradingPlaybook.test.ts` | Candidate playbook tests | Test suite | Model prompt/authority tests | Deleted |
| Candidate helpers in `__tests__/helpers.ts` | Candidate/Risk fixtures | Candidate tests | Neutral helpers | Removed |
| Candidate replay action | Deterministic trade decision in replay | `replayDecision` | `ReplayMarketFacts` only | Removed |
| Candidate identifiers/types | `TradeCandidate`, result/best/selected ID | Deleted modules and synthesizer | `ModelTradePlan` | Removed from Trade Candidate runtime |
| Candidate drawing selection | selected POI and Candidate levels | Orchestrator/drawing plan | Model plan drawing builder | Removed from active new-analysis path |
| Candidate fallback/dual mode | Legacy path on off/shadow/failure | Orchestrator | Distinct technical outcomes | Removed |
| `MODEL_FIRST_MODE`/`getModelFirstMode` | Runtime switch | Orchestrator | No mode switch | Removed from active source |

No Candidate-specific migration or MCP schema file was deleted. That is material because persistence and MCP compatibility remain incomplete.

## 6. Remaining Candidate references

The repository-wide scan was not limited to the PR. Matches are grouped below; historical and unrelated matches are not hidden.

| Match/domain | Files | Classification | Safety | Action |
|---|---|---|---|---|
| Historical architecture text | `docs/COMPLETE_CANDIDATE_SYSTEM_REMOVAL.md`, `docs/MODEL_FIRST_POST_IMPLEMENTATION_AUDIT.md`, `modelFirst/AUTHORITY_AUDIT.md`, `MODEL_FIRST_REPORT.md` | Historical docs | Safe at runtime; some claims stale | Keep clearly historical/update claims |
| Untracked planning document | `.cursor/plans/model-first_vision_refactor_904f4e9f.plan.md` | Historical/untracked | No runtime effect; repository hygiene issue because `.cursor` not ignored | Ignore or remove separately |
| Negative-test leak fixtures | `modelFirst/__tests__/{freeModelAuthority,modelFirst,safetyContracts}.test.ts`, integration/evaluation tests | Test | Safe, intentional | Keep |
| Leak detector and technical code | `buildNeutralEvidence.ts`, `runModelFirstDecision.ts`, `technicalOutcome.ts`, comments in model files | Active enforcement | Safe analytically, but literal Candidate terminology remains | Rename only if zero-token criterion is required |
| `OpportunityCandidate`, `candidates`, score/sort/top | `monitor.ts`, `opportunityScan.ts`, cron monitor | Active runtime neutral scanner | No side/entry/SL/TP in shortlist, but violates complete Candidate-domain naming/removal and ranking criterion | Rename to neutral screening items; strengthen architecture test |
| Recommendation context local `candidate` and `candidates` | `app/api/agent/chat/stream/route.ts` | Active context selection | It selects an already-stored recommendation, not a proposal; no new analysis authority | Rename to recommendation context item/list |
| `actionableCandidate` | `orchestrator.ts`, `researchEvidence.ts`, research tests, deep-analysis trigger strings | Active post-decision research | Set only after model BUY/SELL; cannot change final decision, but terminology remains | Rename to actionableDecision/plan |
| Candidate-engine compatibility comment | `agent/risk/validateTradeSetup.ts` | Active file/comment | No runtime authority | Remove stale comment |
| Trade Lesson Candidate domain and DB table | `recommendations/canonical/tradeLessons.ts`, `db/{pg,sqlite}.ts`, tests | Active learning subsystem | Tenant-scoped historical learning; not a market proposal and not execution input until validated lesson reads, but literal Candidate domain persists | Explicitly exempt/rename/migrate |
| Gold-weight candidate versions | `goldLearning.ts`, DB | Active learning version lifecycle | Not a trade proposal | Explicitly exempt/rename |
| Trading DNA `candidates` locals | `tradingDna/shadowTrader.ts`, tests | Research-only historical recommendation filtering | No broker/execution dependency per tests; still Candidate terminology | Rename to matching recommendations |
| Agent-memory Candidate | `agentMemory.ts`, tests, feature flag comment | Preference-memory proposal | Not a trade proposal | Explicitly exempt/rename |
| Generic path/model/skill candidate variables | skill registry, canonical identity, probe models, store email generation, EA download | Generic programming term | Safe | No trade-domain action |
| MCP skill-selection candidates | `mcp/src/skills/select.ts`, tests | Internal skill ranking | Not a trade proposal | Safe but literal scan must exempt it |
| MCP UI candidate compatibility | `mcp/src/ui/{widgets,runtime}.ts`, tests | Active rendering compatibility | Can render `data.candidates`; not model binding | Rename after API migration |
| MCP path candidates | helpers/onboarding/catalog/i18n | Generic path/locale selection | Safe | None |

Exact prohibited identifiers `TradeCandidate`, `selectedTradeCandidateId`, `buildTradeCandidates`, `scorePoi`, `selectedCandidate` remain only in documentation, negative tests, and the untracked plan at PR head. However active source still constructs, ranks, and selects `OpportunityCandidate` items. The current architecture test passes because it scans a narrow prohibited-token list and deliberately excludes several files/tests; it does not establish repository-wide absence.

## 7. Neutral evidence before the model

`NeutralMarketEvidence` currently sends:

- fixed scalping context;
- snapshot ID, symbol, primary timeframe, selection source, context timeframes;
- bid, ask, mid, spread, quote age, server timestamp, source health, fingerprint;
- bounded raw candle envelopes with timeframe, role, source, capture/freshness metadata, requested/available/included counts, first/last times, and OHLCV arrays;
- narrative;
- structure trend and latest structure event (type, direction, broken level);
- recent liquidity sweep count;
- nearest demand/supply facts and zone count;
- current/higher/daily timeframe biases and conflict;
- news risk, reason, and up to eight event metadata records;
- summarized user drawings;
- Vision image metadata and attached neutral images;
- bounded user message and educational-only fact.

Representative shape:

```json
{
  "evidence": {
    "snapshot": {
      "snapshotId": "<uuid>",
      "symbol": "EURUSD",
      "primaryTimeframe": "5m",
      "contextTimeframes": ["15m", "1h", "4h"],
      "bid": 1.1,
      "ask": 1.1001,
      "mid": 1.10005,
      "spread": 0.0001,
      "quoteAgeMs": 1200,
      "serverTimestamp": 1784400000000,
      "sourceHealth": "ok",
      "fingerprint": "<hash>"
    },
    "candleEnvelopes": [
      {
        "timeframe": "5m",
        "role": "primary",
        "source": "ea",
        "includedCount": 120,
        "candles": [{"time": 1784399700, "open": 1.1, "high": 1.101, "low": 1.099, "close": 1.1005, "volume": 100}]
      }
    ],
    "structure": {"trend": "uptrend", "swings": {"count": 8, "latestEvent": {"type": "bos", "direction": "bullish", "brokenLevel": 1.1}}},
    "liquidity": {"recentSweepCount": 1},
    "supplyDemand": {"nearestDemand": "<fact>", "nearestSupply": "<fact>", "zoneCount": 3},
    "mtf": {"currentBias": "bullish", "higherBias": "mixed", "dailyBias": "neutral", "conflict": true},
    "news": {"newsRisk": "unknown", "reason": "<provider state>", "upcomingEvents": []},
    "visionImages": [{"symbol": "EURUSD", "timeframe": "5m", "role": "primary", "drawingsIncluded": false, "recommendationOverlaysExcluded": true}]
  }
}
```

The leak detector rejects non-null keys normalized to Candidate, selected Candidate, selected levels, preferred direction, proposed trade, playbook, and rule-based recommendation. No preferred side, proposed BUY/SELL, entry, stop, target, Candidate score/rank, winning strategy, directional checklist, or pre-approved plan is directly present in this payload.

Completeness gaps against the requested evidence contract:

- `brokerOrSource`, `marketTimestamp`, `pricePrecision`, `tickSize`, and `marketOpen` exist in `MarketSnapshot` but are not copied into `NeutralMarketEvidence.snapshot`.
- Support/resistance arrays, full BOS/CHoCH history, full swing arrays, and full liquidity sweep details are not exposed; only summarized fields are sent.
- ATR/volatility are available indirectly in market/narrative/candles, not as explicit top-level neutral fields in this schema.
- The narrative is generated application text and was not fixture-audited here for all possible directional phrasing.

Result: candidate-free proposal authority is verified; the full requested neutral-evidence payload is **PARTIAL**.

## 8. Free-model authority

`ModelTradePlanSchema` requires:

```text
decision: buy | sell | wait
activation: immediate | conditional | none
marketRegime: trend | range | breakout | reversal | mixed
marketThesis
primaryTimeframe
contextTimeframes[]
timeframeAnalysis[] { timeframe, bias, evidence }
entryZone { low, high, preferred }
invalidation
stopLoss
targets[] { price, reason } (max 3)
requiredConfirmation
pathToEntry
alternativeScenario
confidence (0..1)
summary
keyReasons[]
warnings[]
dataTimestamp
```

There is no Candidate ID, setup ID, POI ID, rank, score, or lookup field. The prompt explicitly makes the model the sole analytical authority and states that conditional BUY/SELL is not WAIT. A model can produce valid BUY/SELL with no application-generated setup because no setup object is accepted by `runModelFirstDecision`.

## 9. WAIT and technical-state semantics

| Condition | Result |
|---|---|
| Successful model `decision:"wait"` | Analytical `wait`; activation forced to `none` by validator |
| Model timeout | `model_timeout` |
| Invalid JSON/schema/empty output | `invalid_model_output` |
| Missing API key, invalid/unavailable model, provider error | `model_unavailable` |
| Request cancellation | `analysis_failed` (distinct from WAIT, but no dedicated cancelled public state) |
| Missing required context candles | `data_unavailable` |
| Quote absent or older than 120 seconds before model | `data_unavailable` |
| Missing Vision with at least 40 primary numeric candles | Continue numeric model analysis; not WAIT |
| Missing Vision plus insufficient numeric candles | `data_unavailable` |
| Stale image capture | Capture returns no images; then numeric sufficiency rule above |
| Invalid BUY/SELL levels | Direction retained; `technically_unavailable` or `levels_require_refresh` execution readiness |
| Failed repair | First directional result retained; execution withheld |
| Broker minimum stop/session/connection/permission failure | Execution blocked after analysis; does not rewrite analytical direction |
| Subscription/authentication failure | HTTP/auth/quota error before analysis; not WAIT |

Tests cover successful WAIT, timeout, invalid output, conditional BUY/SELL, and invalid directional levels. There is no fixed end-to-end fixture for stale snapshot, missing Vision, or failed repair.

## 10. Technical validation

`validateModelTradePlan` runs only after a successful model parse. It checks:

- trade activation present for BUY/SELL;
- finite/preferred entry and entry-zone availability;
- low â‰¤ high and preferred entry inside zone;
- stop, invalidation, and at least two targets;
- BUY stop/invalidation below entry and targets above entry;
- SELL stop/invalidation above entry and targets below entry;
- ascending BUY targets / descending SELL targets;
- current quote and quote-age availability;
- tick alignment for entry, zone, stop, invalidation, and targets;
- stop distance of at least one tick;
- quote age threshold;
- immediate-price distance from entry zone.

It does not check broker precision independently of tick alignment, spread, broker minimum stop level, market session, account ownership, connection health, execution permission, idempotency, or duplicates. Those checks live later in execution guard, bridge preflight, intent execution, broker adapters, `mt5Stops`, and idempotency storage.

The validator returns the original decision and `directionPreserved:true`; it has no code path to choose a strategy, construct a Candidate, or map BUY/SELL to WAIT. It cannot flip BUY to SELL or SELL to BUY.

## 11. Repair pass

The first parsed decision is captured as `lockedDecision`. Only one guarded second call to the same `once` closure exists. It reuses:

- exact model ID;
- exact reasoning effort;
- exact serialized evidence/snapshot;
- exact images;
- exact symbol/timeframe evidence;
- same abort signal and timeout policy;
- `store:false`;
- same strict output schema.

The appended repair text contains the technical error identifiers and instructions to preserve direction and correct the modelâ€™s own levels. It supplies no replacement level, Candidate level, preferred POI, preferred side, stop, or target. After the response, code overwrites `decision` with `lockedDecision` and validates again. If the call throws, the first validation result remains. No loop or third call exists.

## 12. Recommendation drawings

The unified new-analysis path calls only `buildDrawingsFromValidatedModelPlan`, then `runDrawingAgent`. Inputs are `FinalDecisionResult`, `ValidatedTradePlan`, and last candle time. Output is a `DrawingPlan` containing an entry-zone drawing, invalidation annotation, and forecast path to the first target. It uses model-owned entry zone, preferred entry, stop, targets, and invalidation. It cannot alter direction and has no Candidate/POI input.

Defect: when `executionReady` is false, the builder falls back to non-null raw plan levels and may draw them. It does not invent price values, but the â€œvalidatedâ€‌ drawing path can display technically invalid model levels. Historical drawing rendering was covered only by existing unit/storage tests, not a browser fixture with an old Candidate-backed row.

## 13. Recommendation persistence

New executable BUY/SELL recommendations currently persist:

- user/session/chat/analysis identity;
- symbol and primary timeframe;
- direction;
- entry type and preferred entry;
- stop;
- targets and first take-profit;
- invalidation level;
- derived status/expiry;
- setup type (`scalp`);
- model summary/reason arrays in memory;
- chart drawings/hash and price at creation in memory;
- canonical recommendation direction, entry, stop, targets, confidence, strategy/version defaults, lifecycle status, source, engine version, and a limited risk JSON.

Not persisted canonically:

- full entry zone;
- activation enum as a first-class field;
- market thesis;
- required confirmation/path-to-entry/alternative scenario;
- full target reasons;
- model ID and reasoning effort;
- snapshot ID/fingerprint;
- quote timestamp/age;
- context timeframes and timeframe analysis;
- validator errors/state;
- execution-readiness state;
- complete provenance.

No new recommendation stores a Trade Candidate ID. No Candidate-ID column is required by canonical recommendation creation or execution. The old `legacy_tracking_id` is a recommendation tracker identity, not a Trade Candidate ID. No PR migration was added. The legacy in-memory `poi` compatibility object is still populated for new recommendations, including `poi.score = model confidence`; canonical persistence does not store that object through this adapter.

Because required fields and migration/rollback are absent, model-owned recommendation persistence is **not complete**.

## 14. Historical compatibility

Automated tests passed for canonical lifecycle, tracked recommendation migration, recommendation history/stats/sweep, replay market facts, linked trades, tenant scoping, and Trading DNA research-only contracts. `recommendationStore.ts` contains an idempotent legacy tracked-row importer and canonical adapters.

Not verified:

- a production copy of an old Candidate-backed recommendation rendered through the PR head;
- browser rendering of old Candidate drawings;
- a dedicated read-only Candidate compatibility mapper;
- migration rollback, because no Candidate-removal migration exists;
- production database rows against the PR head.

Historical compatibility is **PARTIAL**, not confirmed.

## 15. Platform behavior

`platformChartBoundScope` uppercases the selected symbol and sets the selected interval as `timeframeConstraint`. Context mapping is:

| Primary | Context |
|---|---|
| 1m | 5m, 15m, 1h |
| 3m | 5m, 15m, 1h |
| 5m | 15m, 1h, 4h |
| 15m | 1h, 4h, 1d |
| 30m | 1h, 4h, 1d |
| 1h | 4h, 1d |
| 4h | 1d |
| 1d | none |

The prompt identifies the snapshot primary timeframe as binding and context frames as supporting evidence. Conditional BUY/SELL preservation is unit-tested. Neutral Vision is rendered server-side from snapshot candles and empty overlays/drawings; it does not mutate the visible TradingView symbol, timeframe, viewport, or user drawings. The optional user-context capture copies drawings into a separate image and does not mutate browser chart state.

Exact PR-head browser state preservation was not verified.

## 16. MCP behavior

PR #66 changes no MCP source. Active behavior:

- `run_market_analysis` calls `/api/agent/market/analyze`, which calls `runUnifiedChartAgent`; platform-selected model authority therefore applies to this server-side MCP tool.
- MCP host models can independently use market/OHLC/indicator/level tools, decide, and call `create_recommendation`; the trading skill says the model is sole authority.
- `create_recommendation` accepts action/levels directly from the host model and does not Candidate-bind them, but its web route does not call the new technical validator.
- `scan_market` requires explicit `symbol_scan`, `timeframe_scan`, or `market_scan` scope. The API returns `screeningItems` with symbol, interval, `activityScore`, neutral evidence strings, summary, and price. It returns no BUY/SELL, entry, stop, target, directional score, setup score, or Candidate rank.
- Internal scan implementation still uses `OpportunityCandidate`, Candidate collections, score sorting, and top selection.
- MCP catalog tests pass, but `schemas:check` fails because `manifest.json` and `scan_market` schemas drifted.
- No authenticated live MCP analysis or execution-safety test was run against PR #66.

Scope behavior is statically verified for explicit symbol, timeframe list, and bounded market scan. â€œCurrent chartâ€‌ is supported by `run_market_analysis` optional symbol/interval plus layout resolution. Host-model comparison across broad shortlist items is required by the tool description.

## 17. Functional preservation matrix

| Feature | Previous Candidate dependency | New dependency/evidence | Automated result | Browser/runtime | Status |
|---|---|---|---|---|
| TradingView | None/direct drawing display | Existing chart stack | Build passes only with provisioned local library | PR head not browser-tested | PARTIAL |
| Chart state | Candidate drawings | Model drawings/layout | Unit/context tests | Not PR-qualified | PARTIAL |
| Symbol selector | None | Chart context | Existing tests/build | Baseline only | PARTIAL |
| Timeframe selector | Candidate context | Bound primary scope | Model-first test pass | Baseline only | PARTIAL |
| Raw candles | Candidate builder input | Candle envelopes | OHLC/model tests pass | Not live PR | PASS automated |
| Multi-timeframe | Candidate engine | Context envelopes | Tests pass | Not live PR | PASS automated |
| Vision | Candidate/chart screenshots | Neutral server render | Metadata/retention tests pass | No visual PR test | PARTIAL |
| User drawings | Candidate POI conversion | Summary + labeled image | Drawing tests pass | Not browser-qualified | PARTIAL |
| Recommendation drawings | Selected Candidate/POI | Model plan | Tests pass | Invalid-level defect | NO-GO |
| Recommendation creation | Candidate result | Executable model result | Model tests pass | Persistence incomplete | NO-GO |
| Active lifecycle | Candidate-backed record | Canonical recommendation | Tests pass | No old-row browser test | PARTIAL |
| History | Candidate fields | Canonical adapter | Tests pass | Not runtime-qualified | PARTIAL |
| Replay | Candidate builder | Neutral market facts | Evaluation tests pass | Not production-tested | PASS automated |
| Tracking | Candidate recommendation | Canonical tracker | Tests pass | Not production-tested | PARTIAL |
| Notifications | Candidate recommendation | Stored recommendation | Unit paths pass | Not live-tested | PARTIAL |
| Statistics | Candidate rows | Canonical outcomes | Tests pass | Not browser-tested | PARTIAL |
| Trades | Candidate ID optional link | Recommendation ID optional | Unit tests pass | No live execution | PARTIAL |
| Risk per Trade | Risk Agent mixed role | Post-decision budget/sizing | Lot-sizing tests pass | No live trade | PASS automated |
| Approval flow | Candidate levels | Model/host levels | Static/unit evidence | No authenticated run | PARTIAL |
| Execution | Candidate levels | Technical intent/broker path | Safety tests pass | Provider release EA failed config | PARTIAL |
| MT5/EA | None | Existing adapter | Unit tests pass | Production process online; no PR probe | PARTIAL |
| Bridge | Candidate recommendation optional | Existing bridge | Unit tests pass | No authenticated PR test | PARTIAL |
| MCP | Host Candidate creation wording | Host model / unified agent | 70 catalog tests pass | Schema drift/auth not tested | NO-GO |
| Telegram | Candidate alerts | Recommendation alerts | General tests | Provider unconfigured locally | PARTIAL |
| Voice | None | Existing voice component | Voice tests pass | Whole lint has voice errors | NO-GO lint |
| Conversations | Candidate context | Active recommendation context | Context tests pass | Not browser-tested | PARTIAL |
| Model selector | Model-first | Registry validation | Tests pass | Not PR browser-tested | PARTIAL |
| Reasoning selector | Model-first | Registry capability map | Tests pass | Not PR browser-tested | PARTIAL |
| Research | Post-Candidate influence | Post-model evidence | Research tests pass | Not live PR | PASS automated |
| Deep Analysis | Candidate POI metadata | Model direction/levels | Tests/static path | Not live PR | PARTIAL |
| Subscription/trial | None | Existing gate | Tests pass | Not authenticated live | PASS automated |
| Admin | None | Existing authorization | Unit/static evidence | Not live-tested | PARTIAL |
| Tenant isolation | Candidate records | Canonical user scope | Multiple tests pass | PostgreSQL release absent | PARTIAL |
| Authentication | None | Existing auth | Static/unit evidence | Protected endpoints return 401 | PARTIAL |
| Idempotency | Candidate execution | User/key-scoped bridge cache | Unit/static evidence | No live duplicate test | PARTIAL |
| Reconciliation | Candidate-linked trades | Existing tracker | Tests partial | Not production-tested | PARTIAL |
| Alerts | Candidate signal | Recommendation/technical state | General tests | Not live-tested | PARTIAL |
| Monitoring | Candidate scan | Neutral activity scan | Unit/CI paths | Active Candidate naming remains | NO-GO criterion |

## 18. Complete PR changed-files inventory

| File | Change | Reason / requirement | Coverage |
|---|---|---|---|
| `agent/workspace/EXECUTION_DESK_V3.md` | Modified | Model-plan terminology | Docs only |
| `docs/COMPLETE_CANDIDATE_SYSTEM_REMOVAL.md` | Added | Implementation report | Audit found incomplete claims |
| `SmartChartAgentPanel.tsx` | Modified | Render technical outcomes | Changed-file lint/build |
| `buildDrawingPlan.test.ts` | Modified | Model-level drawing behavior | Test matrix |
| `chartDrawingZones.test.ts` | Deleted | Remove Candidate drawing tests | Replacement model tests |
| `evaluation.test.ts` | Modified | Neutral replay | Test matrix |
| `finalDecisionSynthesizer.test.ts` | Deleted | Remove binder tests | Free-model tests |
| `helpers.ts` | Modified | Remove Candidate fixtures | Test compilation |
| `scalpGeometry.test.ts` | Modified | Model plan geometry only | Decision suite |
| `tradeBrain.test.ts` | Deleted | Remove builder/ranker tests | Free-model tests |
| `tradingPlaybook.test.ts` | Deleted | Remove playbook Candidate tests | Free-model tests |
| `accountRiskSnapshot.ts` | Added | Preserve post-decision account type | Typecheck |
| `finalDecisionAgent.ts` | Modified | Analytical decision union only | Typecheck/tests |
| `finalDecisionSynthesizer.ts` | Deleted | Delete Candidate binder | Architecture tests |
| `riskAgent.ts` | Deleted | Delete pre-decision Risk authority | Architecture tests |
| `integrationBoundaries.test.ts` | Modified | Enforce one path/no mode imports | Test matrix |
| `buildDrawingPlan.ts` | Modified | Rename evidence shortlist/model levels | Drawing tests |
| `replayDecision.ts` | Modified | Facts-only replay | Evaluation tests |
| `fallback.ts` | Modified | Technical states, no synthetic WAIT | Model tests |
| `freeModelAuthority.test.ts` | Added | Architecture/decision fixtures | 11 fixture tests |
| `modelFirst.test.ts` | Modified | New schema fixtures | Model suite |
| `safetyContracts.test.ts` | Modified | Snapshot/provider/validator contracts | Model suite |
| `buildDrawingsFromValidatedModelPlan.ts` | Added | Model-owned drawings | Model/drawing tests |
| `buildNeutralEvidence.ts` | Modified | Neutral evidence/leak detector | Model tests |
| `modelTradePlan.ts` | Modified | Free-model schema/prompt | Model tests |
| `runModelFirstDecision.ts` | Modified | Sole model call, errors, repair | Model tests |
| `technicalOutcome.ts` | Added | Distinct technical states | Model tests |
| `validatedTradePlan.ts` | Modified | Canonical validator name | Validator tests |
| `orchestrator.ts` | Modified | Delete dual Candidate path | Architecture/model tests |
| `buildTradeCandidates.ts` | Deleted | Delete Candidate engine | Architecture scan |
| `chartDrawingZones.ts` | Deleted | Delete Candidate-zone converter | Architecture scan |
| `scalpGeometry.ts` | Modified | Plan geometry scoring rename | Decision tests |
| `scorePoi.ts` | Deleted | Delete POI scoring | Architecture scan |
| `tradingPlaybook.ts` | Deleted | Delete deterministic playbook | Architecture scan |
| `types.ts` | Modified | Technical states/entry zone/readiness | Typecheck/UI |
| `ar.ts` | Modified | Technical-state copy | Build/i18n |
| `en.ts` | Modified | Technical-state copy | Build/i18n |

No migration, generated schema, MCP source, or browser fixture is included. No rename entries were reported by GitHub. All changed files are related to the requested refactor; release completeness defects are omissions, not unrelated additions.

## 19. Test and validation results

| Command/check | Result | Counts/duration/dependencies |
|---|---|---|
| `npm run lint` (`web`) | **FAIL** | 23 errors, 156 warnings; 652.979 s. Three first-party React-hook errors and twenty vendored voice errors; none in PR-changed files |
| ESLint over all changed first-party TS/TSX files | PASS with warning | 0 errors, 1 unused-function warning in `orchestrator.ts`; 51.737 s |
| `npx tsc --noEmit` | PASS | 261.907 s |
| `npm run build` in working copy | PASS | 746.976 s; licensed TradingView files present; two NFT warnings |
| Clean local clone + `npm ci` + `npm run build` | **FAIL** | 571.560 s; missing licensed `@/vendor/tradingview/charting_library`; provisioning was not available in clone |
| `npm run test:ci` | PASS with critical skip | Chained suites passed; unit 319, decision 21, model-first 34; integration 2 passed/1 Redis round-trip skipped; 806.729 s; mostly mocks/local SQLite |
| `npm run test:model-first` | PASS | 34/34, 0 skipped; 148.542 s |
| Candidate architecture scan | PASS but insufficient | Prohibited Trade Candidate token list only; does not catch `OpportunityCandidate`/active generic Candidate domains |
| Raw candle/snapshot tests | PASS | Chronology, metadata, OHLC/unit tests within CI |
| Vision tests | PARTIAL | Metadata/retention pass; no end-to-end image/UI comparison |
| Validator tests | PASS/PARTIAL | Geometry/tick/quote tests pass; broker execution rules tested elsewhere |
| Repair tests | PARTIAL | Static/behavior assertions; no explicit failed-repair fixture |
| Drawing tests | PASS with defect found by inspection | Valid plan covered; invalid-level drawing fallback not covered |
| Persistence/history tests | PASS/PARTIAL | Canonical/tracker/stats tests pass; full model-plan provenance and old Candidate production row not covered |
| Migration tests | PARTIAL | Canonical schema parity tests pass; no Candidate-removal migration exists |
| `npm run typecheck` (`mcp`) | PASS | Completed before catalog |
| `npm run test:catalog` (`mcp`) | PASS | 70/70, 0 skipped; 89.916 s |
| `npm run schemas:check` (`mcp`) | **FAIL** | `manifest.json` drift and `scan_market` schema drift |
| Authenticated MCP tests | NOT RUN | No authenticated AiChart MCP session used against PR head |
| `npm run test:postgres-release` | **FAIL precondition** | `DATABASE_URL is required`; no test executed |
| `npm run test:redis-release` | **FAIL precondition** | `REDIS_URL is required`; no test executed |
| Production `/api/readyz` | PASS for deployed base only | `{"db":true,"redis":"ok"}` on `d995fdf`, not PR head |
| Provider release validator | **FAIL overall** | OpenAI and OANDA passed read-only probes; execution failed `ea_probe_user_not_configured`; research/Telegram unconfigured |
| Subscription/trial/tenant/execution unit tests | PASS automated | Included in CI; no authenticated PR runtime |
| Browser/accessibility qualification | NOT VERIFIED for PR head | Automated browser task was blocked before testing by an unpaid Cursor invoice; production also runs the base commit |
| GitHub CI | **FAIL before steps** | Web and MCP jobs; account locked due billing; exact SHA `2b9a8ef` |
| `git diff --check` | **FAIL** | Four trailing-space lines in existing report |
| Secret scan | PARTIAL | `gitleaks` unavailable; redacted regex scan found 0 potential patterns |
| Untracked review | **FAIL hygiene** | `.cursor/` untracked and not ignored |

Critical skipped tests are not counted as successful.

## 20. Decision-distribution evidence

| Fixture | Model result | Validator result | Final analytical decision | Execution readiness |
|---|---|---|---|---|
| BUY | BUY with valid levels | Ready | BUY | ready for approval |
| SELL | SELL with valid levels | Ready | SELL | ready for approval |
| Conditional BUY | BUY/conditional | Direction preserved | BUY | waiting for confirmation |
| Conditional SELL | SELL/conditional | Direction preserved | SELL | waiting for confirmation |
| WAIT | WAIT/none | No levels required | WAIT | none |
| Model timeout | No model result | Not run | No analytical decision; `model_timeout` | none |
| Invalid model output | No parsed result | Not run | No analytical decision; `invalid_model_output` | none |
| Stale snapshot | No dedicated fixture | Quote precheck/age rules only | NOT VERIFIED as full snapshot fixture | withheld by applicable data/quote rule |
| Missing Vision | No end-to-end fixture | Numeric sufficiency branch | Model still decides if â‰¥40 candles; otherwise `data_unavailable` | depends on model/validation |
| Invalid BUY levels | BUY | Not ready | BUY | technically unavailable |
| Invalid SELL levels | SELL | Not ready | SELL | technically unavailable |
| Failed repair | No dedicated fixture | Code retains first validation | Direction locked by inspection | technically unavailable |

The covered distribution proves the tested path does not collapse BUY/SELL/conditional/timeout/invalid-output into WAIT. Missing fixtures prevent a complete release claim.

## 21. Browser verification

The exact PR head was not deployed and no local authenticated PR server was qualified. The attempted browser qualification did not execute because Cursor rejected the browser task for an unpaid invoice. Public production checks apply only to `d995fdf`:

- landing page loaded successfully;
- public health and readiness endpoints passed;
- production page exposes Arabic content and locale/theme controls in markup;
- protected agent/model/status endpoints returned 401 without authentication.

Arabic RTL, English LTR, dark/light, desktop/tablet/mobile, model selector, reasoning selector, chart-state preservation, recommendation/conditional/technical-error/historical rendering, screenshots, and accessibility are **NOT VERIFIED for PR #66**. They are release blockers, not successful tests.

## 22. Security regression evidence

| Control | Evidence | Status |
|---|---|---|
| Authentication | Protected production endpoints return 401; auth code unchanged | PARTIAL |
| Tenant isolation | Context, DB scope, recommendation tests pass | PASS automated |
| Subscription/trial | Unit tests pass | PASS automated |
| Admin authorization | Static/unit tests pass | PARTIAL |
| Arbitrary model/reasoning rejection | Model registry tests pass | PASS automated |
| Cross-tenant drawings/snapshots | Scope tests exist; no live PR probe | PARTIAL |
| MCP authentication | Production MCP reports OAuth; no authenticated PR tool run | NOT VERIFIED |
| Execution approval | Guard and execution tests require approval | PASS automated |
| Duplicate execution/idempotency | Intent and key checks present; no live duplicate run | PARTIAL |
| Stale quote execution | Preflight/quote tests | PASS automated |
| Broker ownership | Account-pinning tests pass | PASS automated |
| Secret leakage | Redaction tests pass; full gitleaks unavailable | PARTIAL |
| `store:false` | Two model-first tests pass; body builder cannot enable storage | PASS automated |

No live trade was sent.

## 23. PR and CI state

- PR: https://github.com/loorksy/AiChart/pull/66
- State: OPEN, non-draft, merge state `UNSTABLE`.
- Head: `2b9a8efcd1d03dcf91717205a3aea2e7473d3b2a`.
- Reviews: none.
- Review decision: empty.
- Requested reviewers: none.
- Inline review comments/threads: none; no unresolved thread was returned.
- Issue comments: one Codex connector notice stating review usage limits were reached.
- Checks on exact head:
  - `Web checks`: FAILURE; zero steps; billing-lock annotation.
  - `MCP checks`: FAILURE; zero steps; billing-lock annotation.
- Branch protection/required checks: main is not protected according to GitHub API, but the repository CI workflow defines both jobs and both are red.
- The PR head did not change after those checks during this audit.

## 24. Deployment state

**Production remains unchanged.**

| Item | State |
|---|---|
| Web health | `status:ok`, version `1.2.0`, commit `d995fdf...` |
| MCP health | online, version `1.1.1`, commit `d995fdf...`, OAuth |
| Readiness | DB true, Redis ok |
| PM2 | web, worker, MCP online |
| Production checkout | `d995fdf...`; dirty operational script mode/content changes and two temporary probe files observed |
| PR deployed | No |
| Target merge commit | Does not exist; PR unmerged |
| DB migration | None in PR; no migration applied |
| Model registry | Protected endpoint; NOT VERIFIED |
| Rollback target | `d995fdf...` |

Deployment blockers are the open/unreviewed PR, red CI, active defects, missing release validators, schema drift, lint, browser qualification, and absence of an exact merge SHA.

## 25. Final release decision

**NO-GO**

| Blocker | Severity | Owner/action | Evidence required |
|---|---|---|---|
| Active Candidate-named scanner/ranking and other active Candidate domains remain | High | Engineering: rename/isolate or document explicit non-trade exemptions; expand repository scan | Zero unsafe active matches and passing broad scan |
| New recommendation persistence omits model plan/provenance/validation state; no migration | High | Engineering/data: implement schema + migration + rollback + compatibility mapper | Migration tests and old/new-row runtime proof |
| MCP schema drift and unvalidated direct recommendation persistence | High | MCP/web: export schemas; validate model-owned plan before persistence | Green schema check and authenticated MCP fixtures |
| Drawing builder may display technically invalid model levels | High | Web: draw only technically accepted levels or mark non-executable safely | Invalid-level drawing fixture |
| GitHub Web/MCP CI failed before execution | Release blocker | Repository owner: resolve billing and rerun exact head | Green checks on final SHA |
| No PR review | Release blocker | Reviewer: complete review and resolve findings | Approved review |
| Whole lint red | High release gate | Web/vendor owners: establish green first-party/vendor baseline | `npm run lint` exit 0 |
| Redis/PostgreSQL release suites not executed | High release gate | Release engineering: provide isolated authenticated services | Passing release validators |
| Exact PR browser/accessibility qualification absent | High release gate | QA: test authenticated PR environment | Required viewport/theme/locale/state artifacts |
| Clean-clone build needs licensed TradingView provisioning and CI never reached it | High release gate | CI owner: restore CI secrets/runner and build | Green provisioned clean build |
| Historical Candidate-backed record not exercised | High | QA/data: fixture/masked production copy test | History/drawing/replay evidence |
| `.cursor/` untracked and unignored; report whitespace | Low | Repository owner: hygiene-only follow-up | Clean `git status`, `diff --check` |

## 26. Required explicit answers

1. **YES** â€” `buildTradeCandidates.ts` is deleted in PR #66.
2. **YES** â€” `scorePoi.ts` is deleted.
3. **YES** â€” `tradingPlaybook.ts` is deleted.
4. **YES** â€” `riskAgent.ts` is deleted from active analysis.
5. **YES** â€” `finalDecisionSynthesizer.ts` is deleted.
6. **YES** â€” principal Candidate tests were deleted and free-model tests added; coverage is incomplete for several required fixtures.
7. **NO** â€” no active source defines the exact `TradeCandidate` type.
8. **YES** â€” active source builds `OpportunityCandidate`; it is a neutral scanner item, not the deleted Trade Candidate plan.
9. **YES** â€” `opportunityScan.ts` sorts active scanner Candidates by score; Trade Candidate ranking itself is deleted.
10. **YES** â€” the scanner selects `top` Candidate items for analysis; the unified model does not select a Trade Candidate.
11. **YES** â€” Trade Lesson Candidates are validated in the learning subsystem; no Trade Candidate plan validator remains.
12. **NO** â€” no active unified-analysis source binds a model response to a Trade Candidate.
13. **NO** â€” new recommendations do not require a Trade Candidate ID.
14. **NO** â€” new drawings do not require a Trade Candidate ID.
15. **NO** â€” canonical recommendation persistence does not require a Trade Candidate ID; full model-plan persistence is incomplete.
16. **NO** â€” execution does not require a Trade Candidate ID.
17. **NO** â€” the active model system prompt has no Candidate-binding instruction.
18. **NO** â€” active trading skills do not require Candidate selection; MCP internals/UI still contain unrelated Candidate terminology.
19. **NO** â€” no environment flag can reactivate the deleted Trade Candidate engine.
20. **NO** â€” no unified-analysis fallback can invoke deleted Candidate logic.
21. **YES** â€” `runUnifiedChartAgent` has one active market-decision architecture; separate research/MCP host paths remain.
22. **PARTIAL** â€” no proposal/Candidate authority is sent, but the requested neutral evidence fields are not all present explicitly.
23. **YES** â€” the selected model independently returns BUY/SELL/WAIT in the unified path.
24. **YES** â€” the model independently generates all trade levels; technical code can reject but not replace them.
25. **YES** â€” in the unified market path, WAIT comes only from a successful model WAIT.
26. **NO** â€” timeout maps to `model_timeout`.
27. **NO** â€” invalid output maps to `invalid_model_output`.
28. **NO** â€” unavailable/stale required data maps to `data_unavailable` or execution refresh state.
29. **NO** â€” missing Vision continues with sufficient numeric candles or becomes `data_unavailable`.
30. **NO** â€” invalid levels retain BUY/SELL and withhold execution.
31. **NO** â€” tested conditional BUY remains BUY.
32. **NO** â€” tested conditional SELL remains SELL.
33. **NO** â€” technical validation cannot alter direction.
34. **YES** â€” one repair call is the maximum.
35. **YES** â€” platform Risk per Trade sizing occurs in execution after a validated/stored plan; MCP direct execution still relies on execution preflight.
36. **YES** â€” platform primary timeframe is bound to the selected chart timeframe by code and unit test.
37. **PARTIAL** â€” MCP trading guidance preserves host-model authority, but authenticated runtime tests and schema parity are not complete.
38. **PARTIAL** â€” broad automated suites pass, but lint, browser, PG/Redis release, historical runtime, and authenticated MCP evidence are incomplete.
39. **NO** â€” PR #66 has no review and both CI checks are red.
40. **NO** â€” production runs `d995fdf`, not the reviewed/corrective head.
41. **NO-GO** â€” blockers are listed above.

## 27. Report-file status

This audit updates `docs/COMPLETE_CANDIDATE_SYSTEM_REMOVAL.md` and adds this evidence file. The documentation edits are intentionally left uncommitted because no commit was requested. Any later corrective code must be described explicitly and all affected checks rerun on the new PR head.

## 28. Completion pass (2026-07-19) â€” corrective code

Baseline re-verified before coding:

| Item | Value |
|---|---|
| Repository | `loorksy/AiChart` |
| PR | #66 |
| Branch | `fix/candidate-free-model-authority` |
| Implementation commit | `690d7dfâ€¦` |
| Prior PR head | `2b9a8efâ€¦` |
| Actual PR base / `origin/main` | `d995fdfâ€¦` |
| Rollback target | `d995fdf52ab2983bc116407999777048ee9396e8` |
| Production | Unchanged on rollback target (health probe of public URLs was unavailable from this workstation; prior audit recorded `d995fdf`) |

### Code blockers closed

1. **Screening rename + shortlist authority** â€” `MarketScreeningItem` / `screeningItems` / `activityScore`; deep scan passes the complete bounded shortlist to `runUnifiedChartAgent` (no auto top recommendation).
2. **Terminology isolation** â€” `recommendationSources`, `actionableDecision`; expanded architecture scan.
3. **Model-plan persistence** â€” `modelPlanPersistence.ts` + orchestrator/`saveRecommendation`/`createTrackedRecommendation` wiring; historical mapper; no new `poi.score`.
4. **Drawing safety** â€” only technically accepted geometry; invalid â†’ non-executable note.
5. **Neutral evidence** â€” broker/source, quote timestamps, precision, tick, market-open, ATR/volatility, S/R, BOS/CHoCH history, swings, sweeps, TF freshness.
6. **MCP parity** â€” `create_recommendation` validates host model plans; `schemas:check` and `contract:check` OK after export.
7. **Fixtures** â€” stale quote/snapshot, vision insufficiency, failed repair, cancel, model/execution unavailable, broker min-stop.

### Local verification after completion pass

| Check | Result |
|---|---|
| `npm run test:model-first` | PASS 54/54 |
| MCP `schemas:check` | PASS |
| MCP `test:catalog` | PASS 70/70 |
| Web `tsc --noEmit` | PASS |
| Recommendation resolver + researchEvidence | PASS |
| `test:decision-authority` | PASS 21/21 |
| GitHub CI on final head | Not green (billing lock still blocks runner start) |
| PR review | Not obtained |
| Browser qualification | Not run |
| Merge / deploy | Not performed |

### Updated YES/NO (post-completion code; release still NO-GO)

| Question | Answer |
|---|---|
| Does any pre-model code propose BUY or SELL? | **No** (unified path + neutral screening) |
| Does any pre-model code propose entry, stop, or targets? | **No** |
| Does any active path require a Trade Candidate? | **No** |
| Does any active path bind the model to a Trade Candidate? | **No** |
| Does broad scanning only produce neutral screening items? | **Yes** |
| Does the model compare the complete bounded shortlist? | **Yes** (deep scan prompt + one model call) |
| Is the full model plan durably persisted? | **Yes** (`context_json` envelope) |
| Are new recommendations free of poi.score compatibility? | **Yes** |
| Can invalid levels be drawn? | **No** (executable geometry withheld) |
| Does MCP validate host-model plans before persistence? | **Yes** |
| Are MCP schemas synchronized? | **Yes** (local `schemas:check` OK) |
| Was an old Candidate-backed row tested? | **Yes** (historical mapper unit test) |
| Are PostgreSQL, Redis, MCP auth, browser, lint, build, and CI gates green? | **No** â€” incomplete / CI billing-locked |
| Was the reviewed merge commit deployed exactly? | **No** |
| Final decision | **NO-GO** |
