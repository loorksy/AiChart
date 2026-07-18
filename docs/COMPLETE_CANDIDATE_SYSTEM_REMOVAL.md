# Complete Trade Candidate System Removal

**Branch:** `fix/candidate-free-model-authority`  
**Base commit:** `d995fdf52ab2983bc116407999777048ee9396e8` (`origin/main`)  
**Implementation commit:** `690d7df37ff07b2766ae5aea6d74a5bd976af888`  
**PR:** https://github.com/loorksy/AiChart/pull/66  
**Status:** Implementation complete pending PR review, CI, merge, and production deploy verification.

## 1. Previous candidate architecture

Market evidence → `buildTradeCandidates` / `scorePoi` / `runTradingPlaybook` → `runRiskAgent` → `runFinalDecisionSynthesizer` (bind `selectedTradeCandidateId`) → recommendation / drawings / persistence.

Dual mode via `MODEL_FIRST_MODE` (`live` | `shadow` | `off`) could reactivate the candidate engine.

## 2–10. Deleted modules, types, schemas, APIs

| Deleted | Role |
|---|---|
| `web/src/lib/agent/trading/buildTradeCandidates.ts` | Trade proposal builder |
| `web/src/lib/agent/trading/scorePoi.ts` | POI / setup scorer |
| `web/src/lib/agent/trading/tradingPlaybook.ts` | Directional playbook gate |
| `web/src/lib/agent/trading/chartDrawingZones.ts` | User-drawing → trade zone converter |
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

## 12–13. Runtime flags and fallbacks removed

- No `MODEL_FIRST_MODE` / shadow / off / legacy live toggle.
- Model timeout / invalid JSON / missing data → technical decisions (`model_timeout`, `invalid_model_output`, `data_unavailable`, …) — **never WAIT**.
- No candidate-engine fallback under any failure.

## 14. Final free-model architecture

```
User-selected symbol + timeframe
→ immutable snapshot + raw OHLCV + neutral facts + Vision
→ selected model (Responses Structured Outputs)
→ BUY | SELL | WAIT + model-owned plan
→ validateModelTradePlan
→ one repair pass (direction locked)
→ Risk per Trade sizing + explicit approval + broker guards
→ execution
```

## 15–16. Model I/O

- **Input:** `NeutralMarketEvidence` (candles, quote, structure facts, S/D locations as facts, news metadata, Vision metas). Leak detector blocks proposal authority keys.
- **Output:** `ModelTradePlan` (`decision`, `activation`, `marketRegime`, thesis, timeframe analysis, entry zone, invalidation, stop, targets, confirmation, path, alternative, confidence, summary, …). No candidate ID fields.

## 17–18. WAIT and technical errors

- **WAIT** only when the model successfully returns `decision: "wait"`.
- Technical states: `data_unavailable`, `model_unavailable`, `model_timeout`, `invalid_model_output`, `analysis_failed`, `execution_unavailable`, `reanalysis_required`.

## 19–20. Validator and repair

- `validateModelTradePlan` (alias of technical validator): geometry / freshness / tick alignment only; **never** changes direction.
- One repair pass with technical errors only; direction immutable; failed repair keeps BUY/SELL with `executionReadiness: technically_unavailable`.

## 21–22. Platform + MCP

- Platform primary timeframe remains user-selected chart TF; context TFs are evidence.
- MCP skill search found no trade-candidate binding instructions in trading skills.
- Neutral market shortlists for discovery remain allowed; they must not pre-decide BUY/SELL levels.

## 23–24. Persistence / history

- New recommendations store model plan levels / zone; no candidate ID required.
- Historical `poi` display fields may be filled from the model entry zone for UI continuity.
- Old DB nullable candidate-like columns (if any) remain read-only historical; not populated for new analyses.

## 25–26. Architecture tests

- `freeModelAuthority.test.ts`: repository scan + decision-distribution fixtures.
- `integrationBoundaries.test.ts`: orchestrator must not import Risk Agent / candidate builders / dual mode.
- Model-first / drawing / evaluation tests updated.

## 27–30. Delivery status

| Item | Value |
|---|---|
| PR | https://github.com/loorksy/AiChart/pull/66 |
| Implementation commit | `690d7df` |
| CI | Pending on PR |
| Merge commit | Not yet |
| Deployed commit | Not yet (do not deploy until PR review GO) |
| Rollback | `git revert <merge>` or redeploy previous `d995fdf` |

## Preservation matrix

| Feature | Previous Candidate dependency | Replacement | Tests |
|---|---|---|---|
| Market analysis | Risk Agent + candidates + synthesizer | `runModelFirstDecision` | freeModelAuthority, safetyContracts |
| Recommendation drawings | POI / selectedCandidate | `buildDrawingsFromValidatedModelPlan` / model entry zone in `buildDrawingPlan` | buildDrawingPlan, freeModelAuthority |
| Recommendation persistence | `risk.selectedCandidate` | Model recommendation + entryZone | storeFinalRecommendation path |
| Deep analysis enqueue | candidate POI type | Model direction → demand/supply | orchestrator |
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
| Technical failure / conditional → WAIT? | **No** |
| Validator can change direction? | **No** |
| Platform TF still binding? | **Yes** |
| MCP host still free? | **Yes** (no candidate binding in skills) |
| Exact candidate-free commit in production? | **Not yet** — deploy only after reviewed merge |

## GO / NO-GO

**NO-GO for production until:** PR reviewed, CI green, merge commit healthz verified, non-executing acceptance checks on BUY/SELL/conditional/WAIT/timeout semantics.
