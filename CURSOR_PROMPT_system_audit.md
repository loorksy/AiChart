# Lonora — System Audit Prompt (project-grounded)

> انسخ هذا البرومبت كاملاً إلى وكيل قراءة-فقط. الهدف: ملف توثيق واحد
> `LONORA_SYSTEM_AUDIT.md` في جذر المستودع. **لا تعدّل أي كود** — اقرأ ووثّق فقط.
>
> هذا البرومبت مبني على هيكل المستودع الفعلي (Lonora / سابقاً AiChart). المسارات
> والأدوات وأسماء الدوال أدناه نقاط انطلاق إلزامية — لا تستبدلها بافتراضات عامة
> عن منصات تداول. إن لم تجد شيئاً في الكود: اكتب `not found` أو `not implemented`.

---

You are auditing an existing trading platform codebase called **Lonora** (formerly AiChart).
Your job is to explore the entire repository and produce **ONE** comprehensive markdown
documentation file explaining exactly how the system works end-to-end — do **NOT** modify
any code, only read and document.

**Output file:** `LONORA_SYSTEM_AUDIT.md` at the repo root.

**Hard rules**
- Cite real file paths + function/route/tool names. Prefer short code quotes over paraphrase
  for prompts, schemas, and gate conditions.
- Do not invent providers, symbols, timeframes, models, or gates from general trading knowledge.
- Env: document **variable names only** (from `.env.example`) — never values or secrets.
- Docs under `docs/` are hints, not ground truth. Prefer implementation. When docs disagree
  with code, flag the inconsistency under Known Issues.
- Historical docs may say `web/` — in this checkout the Next.js app lives at the **repo root**
  (`package.json` name `"web"`, source under `src/`). Use actual paths.
- There are **no** `.mq4` / `.mq5` EA files in-tree. `infra/mt5/` is a shim/bridge residual.
  Treat any leftover `ea` path as residue unless you prove a live code path still uses it.
- Dual surfaces exist: **in-app web agent** (`src/lib/agent/*` + `/api/agent/*`) and
  **remote MCP** (`mcp/` → Bridge HTTP → same platform APIs). Document both when they diverge.

---

## Already-known map (start here — verify, do not skip)

### Major folders (confirm / correct one-line purposes)

| Path | Start-here purpose (verify in code) |
|------|-------------------------------------|
| `src/` | Next.js app: UI, `/api/*`, unified chart agent, candle warehouse, execution safety |
| `src/app/` | App Router pages + API routes (`chart`, `chat`, `recommendations`, `api/agent`, `api/market`, `api/cron`, …) |
| `src/lib/agent/` | Decision engine: `orchestrator.ts`, specialist agents, synthesizer, prompts, tools, guards |
| `src/lib/recommendations/` | Canonical lifecycle, tracker, tradability, auto-executor, sweep |
| `src/lib/ohlc/`, `src/lib/candles/`, `src/lib/markets/` | OHLC fetch, indicators, warehouse, data-source resolution |
| `src/lib/brokers/`, `src/lib/metaapi/`, `src/lib/mt5/`, `src/lib/bridge/` | Broker adapters, MetaApi, trade readiness / bridge |
| `src/lib/db/` | SQLite + Postgres schema (`sqlite.ts`, `pg.ts`) |
| `src/components/chart/`, `src/components/agent/`, `src/components/recommendations/` | Chart (TradingView), agent UI, recommendation panels |
| `mcp/` | Remote MCP server (Claude Connectors): tools, skills, OAuth, widgets |
| `mcp/schemas/tools/` | Per-tool JSON schemas (count them; do not trust a stale number) |
| `mcp/src/tools/` | Tool handlers + `TOOL_CATALOG` in `schemas/index.ts` |
| `agent/` | Legal content package: constitution, skills, tool contract |
| `agent/workspace/SYSTEM.md` | **Canonical agent constitution** (web + MCP derive from this) |
| `agent/workspace/skills/` | Skill markdown packs (`aichart-trading`, `cards`, `pattern-atlas`, `trading-lexicon`, `trading-strategies`) |
| `agent/tools/contract.json` | Generated cross-surface tool contract (`npm run contract:export` in `mcp/`) |
| `research-service/` | Isolated Python FastAPI: backtests, statistical validation, Research Swarm |
| `infra/` | Deploy: PM2, Docker, nginx, MT5 shim, TradingView bridge scripts |
| `docs/` | Architecture notes (secondary to code) |
| `public/charting_library/` | Vendored TradingView charting library |
| `vendor/realtime-voice-component/` | Voice control widget (optional surface) |
| `.cursor/skills/`, `.claude/` | Agent/ops skills — not product runtime |

### Seed entrypoints (trace from these)

| Concern | Seed files / symbols |
|---------|----------------------|
| Web agent loop | `src/lib/agent/orchestrator.ts` → `runUnifiedChartAgent` / `runUnifiedChartAgentInner` |
| Final decision / LLM synth | `src/lib/agent/agents/finalDecisionSynthesizer.ts` → `runFinalDecisionSynthesizer` |
| Specialist agents | `src/lib/agent/agents/*` (`marketDataAgent`, `structureAgent`, `multiTimeframeAgent`, `liquidityAgent`, `supplyDemandAgent`, `newsMacroAgent`, `riskAgent`, `drawingAgent`, `executionGuardAgent`, `finalDecisionAgent`) |
| System / chart prompts | `agent/workspace/SYSTEM.md`; `src/lib/agent/systemPrompt.ts` (`SMART_CHART_AGENT_SYSTEM_PROMPT`); `src/lib/agent/canonicalIdentity.ts` |
| Intent routing | `src/lib/agent/intentRouter.ts` |
| Market data source | `src/lib/markets/marketDataSource.ts` → `resolveMarketDataSource`; env `FOREX_DATA_SOURCE`, `FOREX_BACKEND` |
| OHLC / warehouse | `src/lib/ohlc/fetchOhlc.ts`, `src/lib/candles/candleRepository.ts`, `src/lib/candles/warehouseOhlc.ts`; cron `src/app/api/cron/candle-warehouse/` |
| Indicators | `src/lib/ohlc/indicators.ts` → `computeForexIndicators`; primitives in `src/lib/indicators.ts` |
| Geometry / patterns | `src/lib/chart/geometry/detectGeometry.ts` + detectors under `src/lib/chart/geometry/` |
| Recommendation create / lifecycle | `src/lib/recommendations/*`, `docs/RECOMMENDATION_LIFECYCLE.md` (verify); types in `src/lib/types.ts` (`Recommendation`) |
| Tradability gate | `src/lib/recommendations/tradability.ts` → `assessTradability` |
| Auto-execute | `src/lib/recommendations/autoExecutor.ts` → `maybeAutoExecute` |
| Lot sizing | `src/lib/brokers/lotSizing.ts` → `computeForexLots` |
| Execution | `src/lib/execution.ts` → `executeIntent`, `getRiskBudget` |
| Trade readiness | `src/lib/bridge/tradeReadiness.ts` → `buildTradeReadiness`, `collectTradeReadinessBlockers` |
| Trade setup validation | `src/lib/agent/risk/validateTradeSetup.ts` |
| Portfolio / sync gates | `src/lib/agent/portfolioGate.ts` → `evaluatePortfolioGate`; `src/lib/agent/marketContext/marketSyncGuard.ts` → `evaluateMarketSync` |
| Trade mode (auto vs advisory) | `src/lib/agent/tradeMode.ts`; MCP tools `get_agent_trade_mode` / `set_agent_trade_mode` |
| MCP server entry | `mcp/src/index.ts`; tools `mcp/src/tools/{core,market,mt5,charts}.ts` |
| MCP bridge client | `mcp/src/bridge/client.ts` |
| Skills | Web: `src/lib/agent/skills/*`; MCP: `mcp/src/skills/{catalog,select}.ts`; content: `agent/workspace/skills/` |
| Research / swarm | `research-service/app/{main,backtest,swarm,validation,strategies}/` |
| Chart drawing UI | `src/components/chart/TvChart.tsx`; agent drawing: `src/lib/agent/drawingCommands/*`, `src/lib/chart/drawings/` |
| Cron / monitors | `src/app/api/cron/{event-monitor,daily-summary,recommendation-sweep,candle-warehouse,strategy-pipeline,...}` |
| Schema | `src/lib/db/sqlite.ts` (and `pg.ts` parity) — tables `recommendations`, `trade_intents`, `trades`, `market_candles`, … |

### Env names to inventory (names only — from `.env.example`)

At minimum document presence/role of: `ENCRYPTION_KEY`, `APP_SECRET`, `DB_PATH`, `DATABASE_URL`,
`OPENAI_API_KEY`, `AI_MODEL`, `AI_QUICK_MODEL`, `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, `OANDA_ENV`,
`TELEGRAM_BOT_TOKEN`, `CRON_SECRET`, `REDIS_URL`, `FOREX_BACKEND`, `FOREX_DATA_SOURCE`,
`CANDLE_SYNC_SYMBOLS`, `CANDLE_SYNC_INTERVALS`, `FEATURE_*`, `AGENT_*`, `VISION_DECISION_V1`,
`CASE_MEMORY_V1`, `RESEARCH_SERVICE_*`, `MCP_*`, `STALE_QUOTE_MS`, `MAX_SPREAD_PIPS`,
`BRIDGE_CACHE_TTL_MS`, `STRATEGY_PIPELINE_*`. List any others you find in `.env.example` only.

### Existing docs useful as cross-check (not as source of truth)

`docs/RECOMMENDATION_LIFECYCLE.md`, `docs/TOOL_REGISTRY.md`, `docs/tool-inventory.md`,
`docs/SKILL_SYSTEM.md`, `docs/VISUAL_CONFIRMATION.md`, `docs/RESEARCH_SERVICE.md`,
`docs/RESEARCH_SWARM_ARCHITECTURE.md`, `docs/TRADING_DNA.md`, `docs/STRATEGY_SPECIFICATION.md`,
`docs/SHADOW_TRADER.md`, `docs/LEARNING_PIPELINE.md`, `README.md`, `CI_AND_DEPLOYMENT.md`.

---

## STEP 1 — Repo structure

Explore the full tree (frontend, MCP, research-service, agent package, infra, skills, config,
env **names**, DB schema). Produce a folder tree with a **one-line purpose per major folder**.
Call out any dead/orphan directories.

Also answer briefly:
- How many MCP tools exist today? (`ls mcp/schemas/tools/*.json` vs `TOOL_CATALOG` length)
- Which package roots are independently buildable? (`package.json` root, `mcp/package.json`, `research-service`)
- Is EA/MT5 Expert Advisor present as source, or only bridge/shim?

---

## STEP 2 — Trace each area from real code

### 1. DATA INGESTION

Trace actual code paths:

**Required seeds**
- `src/lib/markets/marketDataSource.ts` (`resolveMarketDataSource`)
- `src/lib/ohlc/fetchOhlc.ts`, `src/lib/ohlc/metaApiOhlc.ts`
- `src/lib/candles/*` (warehouse, backfill, completeness)
- `src/app/api/market/{klines,forex-price,ticks,data-source}/`
- `src/lib/metaapi/{client,streaming,lifecycle}.ts`
- MCP: `get_ohlc`, `get_market_price`, `get_market_snapshot`, `get_forex_indicators`, `get_multi_timeframe_snapshot`

**Document**
- Provider(s): OANDA vs MetaApi vs anything else — prove from code which pipe is used when.
- Symbols + timeframes: env defaults (`CANDLE_SYNC_SYMBOLS`, `CANDLE_SYNC_INTERVALS`) and runtime catalogues (`src/lib/markets/symbolCatalogue.ts`).
- Fetch model: polling / websocket / REST / cron warehouse warm — cite the functions.
- Caching: `BRIDGE_CACHE_TTL_MS`, `INDICATORS_CACHE_TTL_MS` (`src/lib/ohlc/indicators.ts`), kline client cache, Redis if used.
- **Every** server-side vs client-side indicator/level/pattern with the computing function. Seed list to complete (do not stop here):
  - `computeForexIndicators` — RSI14, SMA20/50, EMA20, MACD, Bollinger, ATR14, Stochastic, trend
  - `src/lib/indicators.ts` — `atr`, `rsi`, `macd`, …
  - `detectStructureLevels`, `detectNumericMarketRegime`
  - `src/lib/agent/marketContext/detectors.ts` — ATR, swings, trend, major levels, liquidity, S/D zones, regime
  - Geometry: `detectChartGeometry`, `detectCandlesticks`, `detectHeadShoulders`, `detectFlags`, `detectTriangles` / `detectConvergingPatterns`, `detectChannels`, `detectRectangles`, `detectTrendlines`, `detectDoubleExtremes`, `detectTripleExtremes`, `detectCupHandle`
  - MCP `detect_levels`, `detect_market_regime`
  - Anything computed only in the browser / TradingView — say so explicitly

### 2. THE AGENT / DECISION ENGINE ("the brain")

**Required seeds**
- Constitution: `agent/workspace/SYSTEM.md` (quote `instructions-core` / `mcp-core` blocks that are actually injected)
- Prompt assembly: `src/lib/agent/systemPrompt.ts`, `canonicalIdentity.ts`, skill loaders
- Loop: `orchestrator.ts` (`runUnifiedChartAgentInner`) — map every stage
- Synth: `finalDecisionSynthesizer.ts` / `finalDecisionAgent.ts`
- Model selection: where `AI_MODEL` / `AI_QUICK_MODEL` / OpenAI client are chosen
- Tools (web): `src/lib/agent/tools/{toolRegistry,toolExecutor,toolPolicy}.ts` + adapters
- Tools (MCP): full catalog via `mcp/src/tools/schemas/*.ts` + handlers
- Confidence / levels: `confidenceSemantics.ts`, synthesizer output schema, `validateTradeSetup`, `assessTradability`
- Gates that can override/block model output (seed — find all):
  - `runExecutionGuardAgent` / `executionGuardAgent.ts`
  - `evaluateMarketSync` / `marketSyncGuard.ts`
  - `evaluatePortfolioGate` / `portfolioGate.ts`
  - `validateTradeSetup`
  - `assessTradability` (+ platform tradability gate tests)
  - doctrine / WAIT refusal paths (`doctrineGuard` tests exist — find implementation)
  - `collectTradeReadinessBlockers` / `buildTradeReadiness`
  - feature flags in `.env.example` (`AGENT_DOCTRINE_V3`, `REC_REVISIONS_V1`, `AGENT_TRADE_MODE_V1`, `VISION_DECISION_V1`, …)
  - recommendation gate tests under `mcp/src/tools/__tests__/recommendationGate.test.ts`

**Document**
- Which LLM(s)/model(s), file + function.
- Single call vs multi-step / multi-agent — **map every step** in the web loop and the MCP session flow separately if they differ.
- Exact context/prompt assembly — **quote** real system prompts / templates (truncate only if huge; keep the operative rules).
- Every tool the model can call: name, inputs/outputs, purpose from **implementation**.
- How confidence %, entry, SL, TP are decided (model-owned vs server-derived).
- Each validation/gate: condition, whether it rewrites the recommendation or only blocks execution.

### 3. RECOMMENDATION GENERATION FLOW

**Required seeds**
- Create paths: web orchestrator `storeFinalRecommendation` / `persistTrackedRecommendation`; MCP `create_recommendation`; API under `src/app/api/agent/recommendation/`, `src/app/api/recommendations/`
- Lifecycle: `src/lib/recommendations/canonical/*`, `recommendationStore.ts`, `recommendationTracker.ts`, status machine in `docs/RECOMMENDATION_LIFECYCLE.md` (**verify against code**)
- Display: `src/app/recommendations/`, `src/components/recommendations/*`, chart overlays
- Drawing: MCP `draw_on_chart`, `clear_chart_drawings`, `show_live_chart`; web `drawingCommands/*`, `src/lib/chart/drawings/*`, TradingView in `TvChart.tsx` / `public/charting_library`
- Triggers: user chat, `scan_market`, cron sweep/reevaluation (`reevaluationTriggers.ts`, `recommendation-sweep` cron), deep analysis (`src/lib/agent/deepAnalysis/*`)

**Document**
- Full lifecycle of one recommendation: trigger → steps → storage → UI.
- Exact output schema (`Recommendation` in `src/lib/types.ts` + canonical types + MCP create schema). Quote fields.
- How drawings land on the chart (library + draw/createShape calls).

### 4. EXECUTION / RISK LAYER

**Required seeds**
- Approval: `request_approval`, `respond_approval`, `get_pending_approvals`; `TradeIntent` in `src/lib/types.ts`; routes under `src/app/api/agent/trade*`, `src/app/api/trades`
- Modes: advisory vs auto (`tradeMode.ts`, `set_agent_trade_mode`, `maybeAutoExecute`)
- Sizing: `computeForexLots`, Risk per Trade in `src/lib/productModel.ts`
- Execution: `executeIntent`, broker adapters `src/lib/brokers/*`
- Readiness / spread: `tradeReadiness.ts`, `spreadCheck.ts`, env `MAX_SPREAD_PIPS`, `STALE_QUOTE_MS`
- Caps: `autoExecutionDailyCap`, admin limits (`admin_limits` table), any kill-switch (`executionKillSwitch` tests → find impl)

**Document**
- Manual / auto / hybrid approval flow with code citations.
- Every risk limit (max trades, daily loss/cap, position sizing, spread, session, heartbeat, …): where enforced; whether the agent can bypass.
- Exact lot-size formula from code.

### 5. KNOWN ISSUES / TECH DEBT

- Grep: `TODO`, `FIXME`, `HACK`, `mock`, `dummy`, `fallback`, `placeholder`, hardcoded magic numbers that look provisional.
- Flag silent `.catch(() => null)` / swallowed errors on critical paths (orchestrator, execution, recommendation create).
- Flag doc↔code drift (especially EA references, widget counts in `docs/tool-inventory.md`, `web/` vs `src/` paths).
- Flag dual-path inconsistencies (web agent vs MCP) if create/execute/confidence diverge.

### 6. TOOL / MCP INVENTORY

For **every** tool in `mcp/schemas/tools/*.json` (current set includes at least):

`cancel_mt5_order`, `capture_chart_snapshot`, `capture_mt5_chart`, `capture_multi_timeframe_snapshot`,
`clear_chart_drawings`, `close_partial`, `close_trade`, `connect_mt5`, `create_recommendation`,
`detect_levels`, `detect_market_regime`, `disconnect_mt5`, `draw_on_chart`, `evaluate_trade`,
`find_similar_cases`, `get_account_overview`, `get_account_symbols`, `get_agent_capabilities`,
`get_agent_settings`, `get_agent_trade_mode`, `get_chart_link`, `get_chart_state`,
`get_forex_indicators`, `get_live_account`, `get_market_context`, `get_market_price`,
`get_market_snapshot`, `get_mt5_status`, `get_multi_timeframe_snapshot`, `get_ohlc`,
`get_open_trades`, `get_pending_approvals`, `get_portfolio`, `get_recommendation_chart`,
`get_strategy_performance`, `get_trade_lessons`, `get_trade_readiness`, `jobs_wait`,
`list_agent_skills`, `list_chart_layouts`, `list_instruments`, `load_agent_skill`,
`modify_sl_tp`, `open_trade`, `record_exit_decision`, `request_approval`, `resolve_agent_skills`,
`respond_approval`, `run_backtest`, `run_market_analysis`, `scan_market`, `send_telegram_menu`,
`set_agent_trade_mode`, `show_jobs_by_ids`, `show_live_chart`

For each: parameters (from schema), one-line description from **handler implementation**
(not docstring alone), read vs write, and whether a UI widget is attached (`mcp/src/ui/*`).

Also list web-only tools in `src/lib/agent/tools/` that are **not** in the MCP catalog.

---

## STEP 3 — Write `LONORA_SYSTEM_AUDIT.md`

Structure with these headers (in order):

1. `# Lonora System Audit`
2. `## Repo structure`
3. `## 1. Data ingestion`
4. `## 2. Agent / decision engine`
5. `## 3. Recommendation generation flow`
6. `## 4. Execution / risk layer`
7. `## 5. Known issues / tech debt`
8. `## 6. Tool / MCP inventory`
9. `## Open Questions` — anything untraceable, ambiguous, or undocumented

Use short direct quotes for prompts, schemas, and gate logic. End with Open Questions only —
no speculative architecture essay.

---

## Done criteria

- [ ] Every section filled from code citations, or explicitly `not found` / `not implemented`
- [ ] Web loop and MCP path both covered where they differ
- [ ] Full MCP tool table matching current schema count
- [ ] No secrets / env values
- [ ] No code changes outside adding `LONORA_SYSTEM_AUDIT.md`
)
