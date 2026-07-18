# M0 — Authority & dependency audit

Base commit: `ed8d529` (origin/main at branch start).

## Decisions

| Area | Decision |
|------|----------|
| `buildTradeCandidates` | Stop live decision path (M4); retain for replay/tests until dependency-proof delete |
| `runRiskAgent` | Split: neutral evidence only → model; technical validation post-decision |
| `tradingPlaybook` | Remove from pre-decision model input |
| Candidate IDs in DB | Never persisted; new recs stay level-based only |
| LLM trading path | Migrate to Responses API (`store: false`); Chat Completions for non-trading auxiliaries until migrated |
| Chart capture | Neutral Vision = QuickChart direct; never MT5-preferred routes |
| `AI_MODEL` | Seed/fallback then deprecate; user prefs become authority |

## runRiskAgent classification

| Responsibility | Class |
|----------------|-------|
| Range position, sweeps enrich, drawing zones | Neutral evidence — retain |
| Symbol geometry meta (tick/digits) | Neutral / post-decision — retain |
| `buildTradeCandidates` + `best` | Analytical authority — remove from live |
| Playbook checklist to model | Analytical authority — remove |
| `validateTradeSetup` pre-model | Move to ValidatedTradePlan |
| Account warnings | Neutral facts / execution — retain as facts |
| Activity "N مرشح" | Remove candidate framing |

## LLM callers

Trading decision: `finalDecisionSynthesizer` → migrate Responses.  
Auxiliary (may stay Chat Completions temporarily): composeChatMeta, generalAnswer, statusReply, suggestions, ticker, memoryLifecycle, followupAnswer, chartDrawingAnswer, discussUserDrawing, tradePostMortem.

## Capture paths

- Neutral: `lib/chartSnapshot.ts` `buildChartSnapshotBufferForMarket` (no overlays).
- Avoid for decision: `canUseMt5ChartCapture` routes, TV `capturePng`.
