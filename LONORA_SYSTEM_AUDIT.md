# Lonora System Audit

Audit of the Lonora (formerly AiChart) trading platform from implementation in this checkout. Docs under `docs/` were used only as cross-checks; when they disagree with code, the mismatch is listed under **Known issues**. Env names only (no values). Historical paths referring to `web/` map here to the Next.js app at the **repo root** (`package.json` name `"web"`, source under `src/`). There are **no** `.mq4` / `.mq5` / `.ex5` Expert Advisor sources in-tree; `infra/mt5/` is a REST shim residual.

---

## Repo structure

### Package roots (independently buildable)

| Root | Build / run | Role |
|------|-------------|------|
| `/` (`package.json` name `"web"`) | `next build` / `next start`, `npm run worker` | Next.js UI, `/api/*`, unified chart agent, warehouse, execution |
| `mcp/` (`aichart-mcp`) | `tsc` → `node dist/index.js` | Remote MCP server (Claude Connectors) → Bridge HTTP → platform APIs |
| `research-service/` (`aichart-research-service`) | Python FastAPI (`pyproject.toml`, Docker) | Isolated backtests, statistical validation, Research Swarm |
| `vendor/realtime-voice-component/` | local `file:` dependency | Optional voice widget |
| `public/charting_library/`, `src/vendor/tradingview/` | vendored | TradingView charting library (not an app package) |
| `agent/` | content package (no build) | Constitution, skills markdown, generated tool contract |

### Major folders (one-line purpose)

| Path | Purpose |
|------|---------|
| `src/` | Next.js application: App Router pages, `/api/*`, agent, markets, brokers, DB |
| `src/app/` | Pages (`chart`, `chat`, `recommendations`, …) + API routes including `api/agent`, `api/market`, `api/cron` |
| `src/lib/agent/` | Decision engine: orchestrator, specialists, synthesizer, prompts, tools, gates, skills |
| `src/lib/recommendations/` | Canonical lifecycle, tracker, tradability, auto-executor, sweep, revisions |
| `src/lib/ohlc/`, `src/lib/candles/`, `src/lib/markets/` | OHLC fetch, indicators, warehouse, data-source resolution, symbol catalogue |
| `src/lib/brokers/`, `src/lib/metaapi/`, `src/lib/mt5/`, `src/lib/mt5local/`, `src/lib/bridge/` | Broker adapters, MetaApi client/streaming, trade readiness |
| `src/lib/db/` | SQLite (`sqlite.ts`) + Postgres (`pg.ts`) schema parity |
| `src/lib/execution.ts`, `src/lib/executionKillSwitch.ts`, `src/lib/approvalFlow.ts` | Single execution choke point, kill switch, approvals |
| `src/components/chart/`, `agent/`, `recommendations/` | TradingView chart UI, agent chat UI, recommendation panels |
| `mcp/` | MCP server: tools, skills, OAuth, widgets, bridge client |
| `mcp/schemas/tools/` | Per-tool JSON schemas (**55** files) |
| `mcp/src/tools/` | Handlers + `TOOL_CATALOG` in `schemas/index.ts` (**55** entries) |
| `agent/workspace/SYSTEM.md` | Canonical agent constitution (web + MCP derive from this) |
| `agent/workspace/skills/` | Skill packs: `aichart-trading`, `cards`, `pattern-atlas`, `trading-lexicon`, `trading-strategies` |
| `agent/tools/contract.json` | Generated cross-surface tool contract (`npm run contract:export` in `mcp/`) |
| `research-service/` | Python research jobs + swarm under `/internal/research/*` |
| `infra/` | Deploy: PM2, Docker, nginx, MT5 shim, TradingView bridge scripts, VPS helpers |
| `infra/mt5/` | Self-hosted MT5 REST shim (`shim.py`) — experimental Linux/Wine; not an EA |
| `docs/` | Architecture notes (secondary to code) |
| `public/charting_library/` | Vendored TradingView charting library |
| `vendor/realtime-voice-component/` | Voice control widget |
| `scripts/` | Ops, migration, validation scripts |
| `.cursor/skills/`, `.claude/` | Agent/ops skills — **not** product runtime |

### Dead / orphan / residue

| Item | Status |
|------|--------|
| `web/` directory | **Absent** — app is at repo root / `src/` |
| `ea/` directory, `.mq4`/`.mq5`/`.ex5` | **Absent** — no EA source |
| `FOREX_BACKEND=ea\|mt_ea` | Hard-throws in `src/lib/brokers/forexBackend.ts` |
| `FOREX_DATA_SOURCE` | Present in `.env.example`; **unread** under `src/` |
| OANDA as live chart feed | Residual env/docs/scripts/schema defaults; not wired in `resolveMarketDataSource` |
| `infra/mt5/` | Live optional bridge code, but documented non-viable on Linux+Wine |

### Quick answers

- **MCP tools today:** `ls mcp/schemas/tools/*.json` → **55**; `TOOL_CATALOG` length → **55** (match).
- **Independently buildable:** root Next app, `mcp/`, `research-service/` (Python).
- **EA/MT5 Expert Advisor:** **not present as source**; only bridge/shim residual (`infra/mt5/shim.py` + `mt5local` client).

### Env inventory (names only — from `.env.example`)

Documented / present in `.env.example` (including commented keys):

`ENCRYPTION_KEY`, `APP_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DB_PATH`, `DATABASE_URL`, `OPENAI_API_KEY`, `AI_MODEL`, `AI_QUICK_MODEL`, `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, `OANDA_ENV`, `METAAPI_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `CRON_SECRET`, `APP_URL`, `AICHART_SINGLE_USER`, `AICHART_GATE_PASSWORD`, `AICHART_SERVICE_TOKEN`, `AICHART_AGENT_USER_ID`, `AICHART_SELF_URL`, `BRIDGE_CACHE_TTL_MS`, `BRIDGE_RATE_LIMIT_WRITES`, `STALE_QUOTE_MS`, `MAX_SPREAD_PIPS`, `IDEMPOTENCY_TTL_HOURS`, `REDIS_URL`, `REDIS_PASSWORD`, `RESEARCH_SERVICE_ENABLED`, `RESEARCH_SWARM_ENABLED`, `RESEARCH_SWARM_PRESETS_ENABLED`, `RESEARCH_SERVICE_URL`, `RESEARCH_SERVICE_INTERNAL_TOKEN`, `RESEARCH_SERVICE_CLIENT_TIMEOUT_MS`, `RESEARCH_SERVICE_STORAGE`, `RESEARCH_SERVICE_JOB_DB_PATH`, `RESEARCH_BACKTEST_ENABLED`, `RESEARCH_VALIDATION_ENABLED`, `FEATURE_SMART_CHART_AGENT`, `FEATURE_CANDLE_WAREHOUSE`, `FEATURE_NEWS_MACRO_AGENT`, `FEATURE_AGENT_EXECUTION_GUARD`, `FEATURE_MCP_UNIFIED_ENGINE`, `FEATURE_AGENT_SKILLS`, `AGENT_CONTEXT_V2`, `AGENT_RUN_TRACE_V1`, `AGENT_MEMORY_WRITE_V1`, `VISION_DECISION_V1`, `CASE_MEMORY_V1`, `AGENT_DOCTRINE_V3`, `REC_REVISIONS_V1`, `REC_LIFECYCLE_ALERTS_V1`, `AGENT_TRADE_MODE_V1`, `PATTERN_ATLAS_V1`, `EVIDENCE_PIPELINE_V2`, `DEEP_RESEARCH_V2`, `PERFORMANCE_JOURNAL_V1`, `REEVALUATION_TRIGGERS_V1`, `MCP_PUBLIC_URL`, `MCP_PORT`, `MCP_AUTH_SECRET`, `MCP_AUTH_MODE`, `MCP_ACCESS_TOKEN_TTL_DAYS`, `MCP_REFRESH_TOKEN_TTL_DAYS`, `MCP_ALLOWED_HOSTS`, `AGENT_WAKE_ENABLED`, `TRADING_KILL_SWITCH`, `LIVE_TRADING_ENABLED`, `FOREX_BACKEND`, `FOREX_DATA_SOURCE`, `MT5_BRIDGE_URL`, `MT5_BRIDGE_TOKEN`, `PLAYWRIGHT_BROWSERS_PATH`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, `TRADINGVIEW_MCP_ENABLED`, `CANDLE_SYNC_SYMBOLS`, `CANDLE_SYNC_INTERVALS`, `CANDLE_SYNC_MAX_SERIES`, `CANDLE_SYNC_MAX_PAGES`, `CANDLE_HISTORY_YEARS`, `STRATEGY_PIPELINE_USER_ID`, `STRATEGY_PIPELINE_SYMBOLS`, `STRATEGY_PIPELINE_TIMEFRAMES`, `STRATEGY_PIPELINE_BATCH`, `STRATEGY_BACKTEST_TIMEOUT_SECONDS`, `BACKTEST_COST_QUOTE_MAX_AGE_MS`, `BACKTEST_SPREAD_PIPS`, `BACKTEST_SLIPPAGE_PIPS`, `BACKTEST_COMMISSION_PER_LOT_SIDE_USD`, `FMP_API_KEY`, `GIT_COMMIT`, `HTTP_TIMEOUT_MS`, `LLM_TIMEOUT_MS`, `LLM_IDLE_TIMEOUT_MS`, `LOG_FORMAT`, `LOG_LEVEL`, `METRICS_TOKEN`, `PGPOOL_*`, `PGSSL*`, `SENTRY_*`, `WORKER_CONCURRENCY`.

Also used in code but **not** listed in root `.env.example` (flag under Known issues): `AUTO_EXECUTION_STAGE`, `AUTO_EXECUTION_DAILY_CAP`, `TRADABILITY_GATE_V1`, `BOUNDED_COLD_START_V1`, `FOREX_FACTORY_CALENDAR_V1`, `MACRO_EVIDENCE_V1`, `COT_EVIDENCE_V1`, `FRED_API_KEY`, `AI_PROVIDER` / Anthropic / OpenRouter model vars (referenced in `src/lib/llm.ts`).

Research-service local `.env.example`: `RESEARCH_SERVICE_HOST`, `RESEARCH_SERVICE_PORT`, `RESEARCH_SERVICE_INTERNAL_TOKEN`, `RESEARCH_SERVICE_ENV`, `RESEARCH_SERVICE_WORK_DIR`, `RESEARCH_SERVICE_ARTIFACT_DIR`, `RESEARCH_SERVICE_MAX_CONCURRENT_JOBS`, `RESEARCH_SERVICE_MAX_QUEUED_JOBS`, timeout/retry/byte caps, `RESEARCH_SERVICE_STORAGE`, `RESEARCH_SERVICE_JOB_DB_PATH`, swarm flags, process isolation knobs.

### Core DB tables (from `src/lib/db/sqlite.ts`, mirrored in `pg.ts`)

Trading / agent–critical: `users`, `trading_settings`, `admin_limits`, `recommendations`, `recommendation_revisions`, `recommendation_evidence_snapshots`, `recommendation_transitions`, `recommendation_outcomes`, `recommendation_reevaluations`, `tracked_recommendations`, `trade_intents`, `trades`, `mt_accounts`, `market_candles`, `symbol_catalogue`, `cost_samples`, `agent_runs`, `agent_run_steps`, `agent_tool_calls`, `agent_chats`, `agent_chat_messages`, `chart_layouts`, `deep_analysis_runs`, `strategy_backtests`, `market_cases`, `trade_lessons`, `system_flags`, `idempotency_keys`, plus billing/auth/support tables.

---

## 1. Data ingestion

### Provider selection (code truth)

**Market data pipe is MetaTrader-account-only** (`"metaapi"` type covers cloud MetaApi **or** linked `mt5local`):

```1:14:src/lib/markets/marketDataSource.ts
/**
 * The one market-data pipe: the trader's own cloud MetaTrader account.
 * ...
 */
export type MarketDataSource = "metaapi";
```

```55:73:src/lib/markets/marketDataSource.ts
export async function resolveMarketDataSource(
  userId: number | null | undefined,
  _requested?: string | null,
): Promise<MarketDataSourceDecision> {
  // ...
  return {
    source: "metaapi",
    reason: available.metaapi ? "auto_metaapi" : "metaapi_not_connected",
    available,
    preference: "auto",
  };
}
```

Availability = user has `mt_accounts.metaapi_account_id` (cloud id or `"mt5local"`). `_requested` is ignored.

**Execution backend** is separate (`src/lib/brokers/forexBackend.ts` → `getForexBackend`):

- `FOREX_BACKEND=ea|mt_ea` → **throws** (EA removed).
- Forced `metaapi` / `mt5local`, else auto: `MT5_BRIDGE_URL` → mt5local; else `METAAPI_TOKEN` → metaapi.

**OANDA:** `.env.example` still documents `FOREX_DATA_SOURCE=oanda` and OANDA tokens; **no** `process.env.FOREX_DATA_SOURCE` reads under `src/`. No OANDA client module in the live chart/agent fetch path. Ops scripts under `scripts/` may still hit OANDA hosts — not app runtime.

### Symbols and timeframes

| Source | Content |
|--------|---------|
| `.env.example` `CANDLE_SYNC_SYMBOLS` | Example majors/minors + XAU/XAG list |
| `.env.example` `CANDLE_SYNC_INTERVALS` | `1m,5m,15m,30m,1h,4h,1d` |
| Cron defaults | `src/app/api/cron/candle-warehouse/route.ts` — empty symbols → demand/stored series; intervals default as above |
| `src/lib/markets/forexInstruments.ts` | Static `FOREX_INSTRUMENTS` registry + `isKnownForexSymbol` |
| `src/lib/markets/symbolCatalogue.ts` | `seedBrokerSymbols`, `listBrokerCatalogue`, `resolveBrokerSymbol` (`origin='broker'`) |
| MetaApi intervals | `METAAPI_INTERVALS` in `src/lib/ohlc/metaApiOhlc.ts`: `1m,5m,15m,30m,1h,4h,1d,1w` |
| Canonical intervals | `src/lib/markets/intervals.ts` (includes derived resampling plans) |

Also: `CANDLE_SYNC_MAX_SERIES`, `CANDLE_SYNC_MAX_PAGES`, `CANDLE_HISTORY_YEARS`; warm demand in `src/lib/candles/warmDemand.ts`.

### Fetch model

```
UI chart ──► GET /api/market/klines
               ├─ FEATURE_CANDLE_WAREHOUSE → serveWarehouseOhlc (market_candles)
               │    miss/stale → backfillCandles → fetchMetaApiOhlcRange(feeder)
               └─ else fetchOhlc(user) → mt5local mt5Rates OR MetaApi history

Quotes ──► GET /api/market/forex-price → MetaApi RPC getSymbolPrice
Ticks  ──► GET /api/market/ticks (SSE) → subscribeSymbolTicks (streaming)
Cron   ──► POST /api/cron/candle-warehouse → maintainCandleSeries
Agent/MCP ──► /api/agent/market/* → fetchOhlc / getUnifiedPrice / buildForexSnapshot
```

| Function | File |
|----------|------|
| `fetchOhlc` / `fetchAccountCandles` | `src/lib/ohlc/fetchOhlc.ts` |
| `fetchMetaApiOhlc` / `fetchMetaApiOhlcRange` | `src/lib/ohlc/metaApiOhlc.ts` |
| `serveWarehouseOhlc` | `src/lib/candles/warehouseOhlc.ts` |
| `backfillCandles` / `maintainCandleSeries` | `src/lib/candles/candleBackfillService.ts` |
| `getForexLiveQuote` / `getForexLiveMid` | `src/lib/markets/forexPrice.ts` |
| `getRpcConnection` / `getMetaApiAccount` | `src/lib/metaapi/client.ts` |
| `subscribeSymbolTicks` | `src/lib/metaapi/streaming.ts` |
| Lifecycle deploy/undeploy | `src/lib/metaapi/lifecycle.ts` |

Unlinked users: klines return empty + `requires_link: true` (no substitute feed).

### Caching

| Layer | Key / TTL | Store |
|-------|-----------|--------|
| Bridge default | `BRIDGE_CACHE_TTL_MS` (example documents default ~5s) | Redis (`REDIS_URL`) or memory (`src/lib/bridge/`) |
| OHLC | interval-aware TTL via bridge cache | same |
| Indicators | `INDICATORS_CACHE_TTL_MS = 45_000` in `src/lib/ohlc/indicators.ts` | same |
| Client klines | browser `Map` in chart datafeed | client |
| Chart PNG snapshots | in-process | server |

### Server-side indicators / levels / patterns

**`computeForexIndicators`** (`src/lib/ohlc/indicators.ts`): RSI14, SMA20/50, EMA20, MACD, Bollinger, ATR14, Stochastic, `trend` via `trendFromSma`.

**Primitives** (`src/lib/indicators.ts`): `sma`, `ema`, `rsi`, `macd`, `atr`, `bollinger`, `stochastic`, `adx`.

**Levels / regime:**

| Function | File |
|----------|------|
| `detectStructureLevels` | `src/lib/ohlc/structure.ts` |
| `detectNumericMarketRegime` | `src/lib/ohlc/marketRegime.ts` |
| `buildForexSnapshot` | `src/lib/markets/forexSnapshot.ts` |

**Agent market-context detectors** (`src/lib/agent/marketContext/detectors.ts`):

`calculateAtr`, `detectSwings`, `detectTrend`, `detectMajorLevels`, `detectLiquidity`, `detectSupplyDemandZones`, `detectMarketRegime`, `biasFromCandles`.

**Geometry** (`detectChartGeometry` → `src/lib/chart/geometry/*`):

`detectTrendlines`, `detectChannels`, `detectConvergingPatterns` (triangles/wedges), `detectHeadShoulders`, `detectDoubleExtremes`, `detectTripleExtremes`, `detectRectangles`, `detectCupHandle`, `detectFlags`, `detectCandlesticks`, plus pivot helpers / `assessPatternStage`.

**MCP market tools → bridge:**

| MCP tool | Bridge route | Computation |
|----------|--------------|-------------|
| `get_ohlc` | `GET /api/agent/market/ohlc` | `fetchOhlc` |
| `get_market_price` | `…/price` | `getUnifiedPrice` |
| `get_market_snapshot` | `…/snapshot` | `buildForexSnapshot` |
| `get_multi_timeframe_snapshot` | `…/multi-snapshot` | parallel snapshots |
| `get_forex_indicators` | `…/forex-indicators` | `computeForexIndicators` |
| `detect_levels` | `…/detect-levels` | `detectStructureLevels` |
| `detect_market_regime` | `…/detect-regime` | `detectNumericMarketRegime` |
| `scan_market` | `POST …/scan` | undirected opportunity scores (no recommendation write) |

### Client-side only

- In-memory kline cache + tick merge into forming bar (`tvDatafeed` / SSE ticks).
- **TradingView native studies** drawn in the chart UI — not Lonora server truth.
- Agent geometry/indicators are computed server-side; React does not recompute them as authority.

---

## 2. Agent / decision engine

### Dual surfaces

| Surface | Entry | Brain |
|---------|-------|-------|
| In-app web agent | chat stream / analyze APIs → `runUnifiedChartAgent` | `src/lib/agent/orchestrator.ts` |
| Remote MCP | `mcp/src/index.ts` tools → Bridge HTTP → same `/api/agent/*` | Analyze uses **same** orchestrator; hosted-model `create_recommendation` is a separate write path |

Constitution: `agent/workspace/SYSTEM.md`. Loaders: `canonicalIdentityCore()` (`src/lib/agent/canonicalIdentity.ts`); MCP injects `instructions-core` + `mcp-core` via onboarding bootstrap; web uses `SMART_CHART_AGENT_SYSTEM_PROMPT = canonicalIdentityCore() + CHART_ROLE_PROMPT` (`src/lib/agent/systemPrompt.ts`).

### Injected constitution (operative quotes)

**`instructions-core`:**

> Lonora is a chat-first Forex scalping assistant. The model alone owns the analytical decision. Every successful analysis ends in one direction — BUY or SELL — with a complete plan; WAIT is not an analytical outcome. … Keep three layers separate: the analytical view (BUY or SELL), the plan type (immediate, anticipatory, or conditional), and the execution state … Risk per Trade … Live execution requires explicit approval … Never invent market/account data … Never disclose the machinery behind it …

**`mcp-core`:**

> Session start: `get_agent_capabilities` → `get_account_overview` → `get_agent_trade_mode` → `resolve_agent_skills` … `load_agent_skill` … If `needs_choice` … `set_agent_trade_mode`. Per analysis: fresh market evidence → `get_strategy_performance` / `find_similar_cases` → BUY or SELL → plan type + execution state → bind levels … Per execution: `get_trade_readiness` → explicit approval → `open_trade`. Never pass lots/notional/leverage/balance overrides.

### LLM / model selection

| Selector | Location |
|----------|----------|
| `callLLM` / provider routing | `src/lib/llm.ts` (OpenAI / Anthropic / OpenRouter via `AI_PROVIDER`) |
| Deep model | `getActiveModel()` / `getDeepModel()` → `AI_MODEL` (default `gpt-4.1` in code path) |
| Quick model | `getQuickModel()` → `AI_QUICK_MODEL`, falls back to deep |
| Per-request override | `withRequestModel` / `resolveUserModelSelection` |
| Decision call | `runFinalDecisionSynthesizer` → `callLLM(..., { tier: "deep" })` |
| Status refs for MCP | `getAgentModelStatus()` in `src/lib/agentModelConfig.ts` |

### Web loop stage map (`runUnifiedChartAgent` → `runUnifiedChartAgentInner`)

**Wrapper:** create run budget → call inner → on cancel force `operational_blocker` → ensure envelope → `recordAgentOutcome`.

**Early exits (intent router `routeIntent` in `src/lib/agent/intentRouter.ts`):** cancel/draw/explain/track active recommendation; user drawing edits; indicator commands; drawing-only; general-only; market closed (`getSessionStatus`); news-only; no market context → general answer.

**Market fleet:**

| Stage | Function | Critical? |
|-------|----------|-----------|
| `market_data` | `runMarketDataAgent` (+ `evaluateMarketSync`) | Yes — null price / sync fail / catastrophic gaps → blocker |
| Parallel structure | `runStructureAgent`, `runLiquidityAgent`, `runSupplyDemandAgent`, `runMultiTimeframeAgent` | Soft → null + ledger |
| `news` | `runNewsMacroAgent` | Soft → `newsRisk=unknown` |
| Geometry | `detectChartGeometry` | Deterministic evidence |
| Skills | `buildAgentSkillContext` (`FEATURE_AGENT_SKILLS`) | Prompt guidance |
| `risk` | `runRiskAgent` → candidates + `validateTradeSetup` | Yes — fail → operational blocker |
| Pre-decision evidence | lessons, statistical support, cases, macro, COT, visual (`VISION_DECISION_V1`) | Soft |
| `final_decision` | `runFinalDecisionSynthesizer` | Fail → blocker |
| Drawing | `buildDrawingPlan` / `runDrawingAgent` | Soft |
| `execution_guard` | `runExecutionGuardAgent` | Only for trade_execution / trade_management intents |
| Research / deep analysis | bounded research nudge; `enqueueDeepAnalysis` | Soft |
| Persist | `storeFinalRecommendation` → `persistTrackedRecommendation` | Platform may rewrite far → `watch_only` |

Specialists live under `src/lib/agent/agents/*` (`marketDataAgent`, `structureAgent`, `multiTimeframeAgent`, `liquidityAgent`, `supplyDemandAgent`, `newsMacroAgent`, `riskAgent`, `drawingAgent`, `executionGuardAgent`, `finalDecisionAgent` types, `finalDecisionSynthesizer`).

### Synthesizer output (model-owned)

Zod `FinalDecisionModelSchema` (`finalDecisionSynthesizer.ts`):

```
direction: "buy" | "sell"   // no wait
planType: "immediate" | "anticipatory" | "conditional"
confidence: 0..1
selectedTradeCandidateId | proposedLevels
activationCondition / activationRule (required when not immediate)
invalidationRule, alternativeScenario, validityCandles
timeframeRoles, decisionTrace, drawingAdvice, …
```

Operative synth rules (quoted):

> direction: "buy" or "sell". A successful analysis ALWAYS produces one. There is no wait, no neutral, no "unclear".  
> Prefer a same-direction tradeCandidate … proposedLevels using ONLY prices that appear in evidenceLevels.  
> Risk per Trade is intentionally absent: sizing happens after the decision …

Post-model (`applyModelDecision`):

- Direction authoritative.
- Levels grounded via `resolvePlanLevels` (ungrounded → drop levels, keep direction).
- Conflict coerce: `shouldCoerceImmediateOnConflict` may rewrite `immediate` → `conditional`.
- `executionState` from `deriveExecutionState`.
- Confidence: `buildRecommendationConfidence` / `buildDirectionalConfidence` (`confidenceSemantics.ts`).

Entry/SL/TP preferred from risk-stage `buildTradeCandidates` (POI/geometry); model selects candidate or proposes menu-grounded levels. Geometry validated by `validateTradeSetup` (annotates/rejects numbers; **never** flips direction).

### Gates (condition → rewrite vs block)

| Gate | Function | Effect |
|------|----------|--------|
| Market closed | `getSessionStatus` | **Block** analysis |
| Market sync | `evaluateMarketSync` (`marketSyncGuard.ts`) | **Block** on stale/missing; forming-bar drift may pass |
| Catastrophic gaps | coverage `gapped` | **Block** `insufficient_data` |
| Significant gaps | gap severity | **Warn**, continue |
| Risk stage fail | orchestrator | **Block** operational |
| Synthesizer fail | LLM/schema | **Block** decision |
| Activation coherence | synthesizer retry | **Rewrite** / fail |
| Immediate→conditional | `shouldCoerceImmediateOnConflict` | **Rewrite** planType |
| Level grounding | `resolvePlanLevels` | **Drop levels** |
| `validateTradeSetup` | risk agent | Annotate / reject candidate numbers |
| Tradability | `assessTradability` | Platform persist: **rewrite** rejected → `watch_only`; MCP write + `TRADABILITY_GATE_V1`: **block** 409 |
| Doctrine WAIT write | recommendation API + `AGENT_DOCTRINE_V3` | **Block** new `wait` writes |
| Execution guard | `runExecutionGuardAgent` | **Block** execute; always requires confirmation (never auto-places) |
| Trade readiness | `buildTradeReadiness` / `collectTradeReadinessBlockers` | Pre-exec blockers (advisory) |
| Portfolio | `evaluatePortfolioGate` | **Block** execution only |
| Trade mode | `getTradeMode` / `isAutoExecutionAuthorized` | Effective advisory if disconnected / flag off |
| Auto stage | `AUTO_EXECUTION_STAGE` | Default `off` blocks placement |
| Kill switch / live dual-enable | `executionKillSwitch` | **Block** at `executeIntent` |

**Note:** `doctrineGuard` exists as **tests** (`src/lib/agent/__tests__/doctrineGuard.test.ts`), not a runtime module named `doctrineGuard`.

### Feature flags (code `FEATURES` + `.env.example`)

Phase/product flags include: `AGENT_DOCTRINE_V3`, `TRADABILITY_GATE_V1`, `FEATURE_AGENT_SKILLS`, `AGENT_CONTEXT_V2`, `AGENT_MEMORY_WRITE_V1` (default **off**), `VISION_DECISION_V1`, `AGENT_RUN_TRACE_V1`, `CASE_MEMORY_V1`, `FEATURE_CANDLE_WAREHOUSE`, `BOUNDED_COLD_START_V1`, `FOREX_FACTORY_CALENDAR_V1`, `MACRO_EVIDENCE_V1`, `COT_EVIDENCE_V1`, `REC_REVISIONS_V1`, `REC_LIFECYCLE_ALERTS_V1`, `AGENT_TRADE_MODE_V1`, `PATTERN_ATLAS_V1`, `EVIDENCE_PIPELINE_V2`, `DEEP_RESEARCH_V2`, `PERFORMANCE_JOURNAL_V1`, `REEVALUATION_TRIGGERS_V1`, plus `FEATURE_*` agent/MCP/news/guard flags in `.env.example`.

### Web tools vs MCP tools

Web agent tool framework: `src/lib/agent/tools/{toolRegistry,toolExecutor,toolPolicy}.ts` + adapters. Registered web-only adapter names: `market_snapshot`, `active_recommendation_read` (MCP equivalents differ by name / surface). MCP exposes the full **55**-tool catalog (see §6).

### Skills

Content: `agent/workspace/skills/{aichart-trading,cards,pattern-atlas,trading-lexicon,trading-strategies}`.  
Web runtime: `src/lib/agent/skills/*` → injected into synthesizer.  
MCP: `resolve_agent_skills` / `load_agent_skill` / `list_agent_skills` (`mcp/src/skills/`).

### Research service (supporting evidence, not the decision brain)

`research-service/app/main.py` mounts:

- `/internal/research/jobs` — backtest/validation jobs
- `/internal/research/swarms` — Research Swarm
- health

Platform calls it when `RESEARCH_SERVICE_*` / swarm flags enable; orchestrator may nudge confidence or enqueue deep analysis — **does not** own BUY/SELL.

---

## 3. Recommendation generation flow

### Triggers

| Trigger | Path | Creates recommendation? |
|---------|------|-------------------------|
| Chat / analyze | `/api/agent/chat/stream`, `/api/agent/market/analyze` → `runUnifiedChartAgent` | Yes (buy/sell + complete levels) |
| MCP `run_market_analysis` | job → same analyze | Yes when engine completes |
| MCP `create_recommendation` | `POST /api/agent/recommendation` | Yes (hosted-model plan) |
| MCP `scan_market` | scan endpoint | **No** — ranks opportunities only |
| Opportunity scan (web) | `opportunityScan.ts` → orchestrator | Yes when deep pass finds buy/sell |
| Cron `recommendation-sweep` | `runRecommendationSweep` | **No create** — evaluate / transition / maybe auto-exec / reevaluate |
| Deep analysis | `enqueueDeepAnalysis` → completion | **No create** — confirm/revise/invalidate via revision |

### Platform create path

```
runUnifiedChartAgent
  → … fleet + synthesizer …
  → storeFinalRecommendation()   // buy/sell + levels; skip if purpose=reevaluation
       → rememberActiveRecommendation()
       → persistTrackedRecommendation()
            → assessPlanTradability()  // rejected → watch_only (no 409)
            → createTrackedRecommendation() → createCanonicalRecommendation()
```

### MCP create path

```
create_recommendation (mcp/src/tools/core.ts)
  → Zod createRecommendationInput
  → POST /api/agent/recommendation
  → validateCompletePlan + tradability gate (rejected → 409 if TRADABILITY_GATE_V1)
  → saveRecommendation() → createCanonicalRecommendation()
  → attachChartToRecommendation() + recommendation card widget
```

### Output schema

**`Recommendation`** (`src/lib/types.ts`):

```92:134:src/lib/types.ts
export interface Recommendation {
  id: number;
  user_id: number;
  analysis_id?: string | null;
  session_id?: string | null;
  chat_id?: string | null;
  symbol: string;
  action: RecommendationAction; // "buy" | "sell" | "wait"
  direction?: RecommendationAction | null;
  entryType?: "market" | "buy_limit" | "buy_stop" | "sell_limit" | "sell_stop";
  confidence: number;
  // … backtested_confidence, entry, stop_loss, take_profit, targets_json,
  // risk_json, timeframe, rationale, factors, chart_*, pattern_name,
  // source: "web" | "agent", market, memory_refs_json, strategy_*,
  // expires_at, status, status_reason, engine_version, …
  created_at: string;
}
```

Canonical authority adds `planType`, `executionState`, `targets[]`, revisions/evidence tables (`src/lib/recommendations/canonical/types.ts`).

MCP create requires plan contract fields including `plan_type`, levels, `rationale`, `factors`, `invalidation_rule`, `alternative_scenario`, `validity_candles`, and for conditional/anticipatory: `activation_condition` + `activation_rule`. `execution_state` is **server-derived**.

### Canonical status machine (code)

```7:33:src/lib/recommendations/canonical/stateMachine.ts
const TRANSITIONS = {
  draft: ["active", "cancelled", "invalidated"],
  active: ["triggered", "sl_hit", "expired", "cancelled", "invalidated"],
  triggered: ["partially_closed", "tp_hit", "sl_hit", "expired", "cancelled", "invalidated", "closed"],
  partially_closed: ["tp_hit", "sl_hit", "expired", "cancelled", "invalidated", "closed"],
  tp_hit: [], sl_hit: [], expired: [], cancelled: [], invalidated: [], closed: [],
};
```

`initialRecommendationStatus`: complete buy/sell plan → `active`, else `draft`.

Tracker UI statuses (`pending_entry`, `tp1_hit`, …) are **projections**, not the canonical enum (`src/lib/recommendations/types.ts`).

**Doc drift:** `docs/RECOMMENDATION_LIFECYCLE.md` matches the transition table; cron comments that claim “no execution” are outdated when `AUTO_EXECUTION_STAGE !== "off"` because `maybeAutoExecute` runs from the tracker.

### Post-create lifecycle

```
create (usually active)
  → cron recommendation-sweep (~5m) / internalScheduler
  → trackOneRecommendation → evaluate vs warehouse candles
  → transitions / lifecycle events
  → maybeAutoExecute on "activated"
  → detectReevaluationTriggers → runReevaluationCycle
       → applyRecommendationRevision (only mutator of plan levels)
  → notifyLifecycleEvents
```

### UI / drawings

- List hub: `src/app/recommendations/` → performance/detail; panels under `src/components/recommendations/*`.
- Web analyze SSE → `SmartChartWorkspace.handleAgentResult` → `TvChart.applyDrawings` merges overlays + drawings into the TradingView manager (`src/components/chart/TvChart.tsx`).
- MCP: `draw_on_chart` / `clear_chart_drawings` / `show_live_chart` → `POST/GET /api/agent/chart/layout` → layout `state_json` hydrated by open chart.
- Ownership model: `src/lib/chart/drawings/types.ts` (`user` | `agent` | `recommendation`).

### Web vs MCP create differences

| Dimension | Platform engine | MCP `create_recommendation` |
|-----------|-----------------|-----------------------------|
| Decision | Server synthesizer | Hosted model + server validate/store |
| Tradability rejected | Downgrade `watch_only` | HTTP **409** when gate on |
| Confidence | Engine 0–1; tracker create hardcodes `confidence: 0` on canonical input | Server-calibrated 0–100 scale on write route |
| WAIT | Engine does not store wait as success | Schema residual; refused when `agentDoctrineV3` |
| Chart | Live TV drawings via SSE | Auto chart PNG + card widget |

---

## 4. Execution / risk layer

### Modes (`src/lib/agent/tradeMode.ts`)

- `advisory` — analyse / recommend / notify; no standing placement.
- `auto` — standing authorisation when plan conditions met; **does not** relax gates or sizing.
- `unset` → `needsChoice: true` when connected.
- Effective mode downgrades if disconnected, epoch mismatch (`login:server`), or `AGENT_TRADE_MODE_V1` off.
- Shared state for web + MCP (`get_agent_trade_mode` / `set_agent_trade_mode`).

### Manual approval flow

1. MCP `request_approval` → `POST /api/agent/approval/request` → `createApprovalRequest` (`authorization_source: "user_approved"`, `pending`).
2. `get_pending_approvals` → list pending intents.
3. `respond_approval` / web `POST /api/trades/intents/[id]` → `respondToApproval` → `executeIntent(..., { explicitApproval: true })`.
4. Choke point requires proven approval row (`approved_by_user_id`, fresh `approved_at`, unconsumed) — body flags alone cannot mint approval.

### Auto flow

`recommendationTracker` on lifecycle `activated` → `maybeAutoExecute` (`src/lib/recommendations/autoExecutor.ts`):

- `AUTO_EXECUTION_STAGE` ∈ {`off` (default), `dry_run`, `demo`, `live`}
- `isAutoExecutionAuthorized`
- complete levels; daily cap `AUTO_EXECUTION_DAILY_CAP` (default **6**)
- demo stage requires demo broker env; dry_run logs only
- binds canonical id + revision → `createIntent(... standing_auto)` → `executeIntent({ explicitApproval: false })`

MCP `open_trade` → `POST /api/agent/trade/open` also stamps `standing_auto` and requires live auto grant.

### `executeIntent` gate order (`src/lib/execution.ts`)

1. Locks  
2. Kill switch / live dual-enable (`TRADING_KILL_SWITCH` env **or** DB `trading_kill_switch`; live needs `LIVE_TRADING_ENABLED` **and** DB `live_trading_enabled`)  
3. `AUTO_EXECUTION_STAGE`  
4. Authorization source (`user_approved` proven **or** `standing_auto` re-checked)  
5. Stale revision CAS (`REC_REVISIONS_V1`)  
6. `validateExecutionIntent` (`admin_limits.can_execute`, SL geometry, forex spot)  
7. Verified equity / Risk per Trade budget (`getRiskBudget`)  
8. `evaluatePortfolioGate`  
9. Consume approval if applicable  
10. Broker adapter `placeOrder` → lot math + send  

### Lot-size formula (exact)

Risk budget: `riskAmount = equity * riskPct / 100` with `RISK_PER_TRADE` bounds `{ min: 0.1, max: 5, step: 0.1, default: 1 }` (`productModel.ts`).

```52:112:src/lib/brokers/lotSizing.ts
 *   lossPerLot = |entry-stop| / tickSize * tickValue
 *   lots       = riskAmount / lossPerLot
...
  const lossPerLot = (stopDistance / tickSize) * tickValue;
  const lots = floorToStep(Math.min(riskAmount / lossPerLot, maxLot), lotStep);
  if (lots < minLot) {
    return fail("الحد الأدنى للوت يتجاوز Risk per Trade؛ لم يُرسل أي أمر.");
  }
```

Always round **down**; never upsize past Risk per Trade. Used by both `metaApiAdapter` and `mt5LocalAdapter`.

### Portfolio limits

```32:37:src/lib/agent/portfolioGate.ts
export const DEFAULT_PORTFOLIO_LIMITS = {
  maxTotalRiskFraction: 0.06,
  maxCorrelatedRiskFraction: 0.03,
  maxOpenPositions: 5,
  maxDailyLossFraction: 0.05,
};
```

Order: daily loss → open count → total risk → correlated (USD pairs / metals groups). Execution-only; never rewrites recommendation.

### Tradability (publishability, not sizing)

```30:36:src/lib/recommendations/tradability.ts
export const TRADABILITY_LIMITS = {
  nowMaxAtr: 0.4,
  soonMaxAtr: 1.5,
  maxPublishableAtr: 3,
  // …
};
```

### Spread / stale quote / session / heartbeat

| Control | Where | Enforced at placeOrder? |
|---------|-------|-------------------------|
| `MAX_SPREAD_PIPS` / `STALE_QUOTE_MS` | `src/lib/bridge/freshness.ts` defaults 30 / 5000 | **No** — readiness marks quote/heartbeat `applies: false` post-EA |
| Analytical spread | `spreadCheck.isSpreadTooHigh` (ATR/stop fractions) | Decision/Execution Guard only |
| Forex weekend session | `isForexSessionOpen` | Readiness + Guard; **not** inside `executeIntent` |
| Heartbeat | legacy EA path removed | readiness always non-applicable |

### Broker path

`resolveBrokerForMarket` / `getForexBackend` → `metaApiAdapter` or `mt5LocalAdapter`. Both: online meta → symbol spec → `computeForexLots` → market order with SL/TP → `recordTrade`.

### Can the agent bypass?

**No** for: kill switch, dual-live, authorization source, stage off, portfolio, lot formula, admin `can_execute`, revision CAS.  
**Weaker / not at choke point:** pip-spread ceiling, quote staleness, session (broker may still reject). Model cannot pass lots/notional/leverage overrides.

---

## 5. Known issues / tech debt

### High — runtime / safety drift

1. **Quote freshness & `MAX_SPREAD_PIPS` vacuous on execute** — `tradeReadiness.ts` hardcodes quote/heartbeat non-applicable after EA removal; `executeIntent` does not call `isQuoteFresh` / max-spread. Flagged reopened in `docs/ADVERSARIAL_FINDINGS_VERIFICATION.md`.
2. **Spread-drift re-evaluation always null** — `recommendationTracker.ts` sets `currentSpread = null` despite MetaApi `cost_samples` feeder in `streaming.ts`.
3. **Confidence dual-path** — synthesizer 0–1; MCP/API write 0–100; platform tracker persist hardcodes `confidence: 0` in `recommendationStore.ts`.
4. **`FOREX_DATA_SOURCE` / OANDA docs vs MetaApi-only runtime** — env and README still describe OANDA warehouse; `resolveMarketDataSource` is metaapi-only; `FOREX_DATA_SOURCE` unread in `src/`.
5. **MCP changelog/README still mention EA / `.ex5` / reconnect tools** that are gone from the 55-tool catalog.

### Medium — doc↔code & dual surfaces

6. Paths `web/src/...` in multiple docs vs actual `src/` (no `web/` dir). `infra/mt5/README.md` still says `web/.env`.
7. `docs/tool-inventory.md` claims **53** tools / **16** widgets; live is **55** schemas + catalog; widget map larger. `LOCAL_RELEASE_QUALIFICATION.md` “57 tools” also drifts.
8. Dual create writers (orchestrator persist vs MCP `create_recommendation`) diverge on tradability enforcement and confidence storage.
9. Silent / best-effort catches on critical paths: orchestrator announce `.catch(() => {})`, evidence `.catch(() => null)`, execution kill-flag reads `.catch(() => null)`, revision seed warn-and-continue.
10. `infra/mt5` Wine/Linux documented non-viable; shim hardcodes `deviation: 20`, `magic: 777001`; MetaApi create uses `magic: 202606`.
11. Root `README.md` still opens with “OANDA بيانات + MT5 تنفيذ” — contradicts market-data code.

### Low / provisional constants

- Scalp geometry (`SCALP_GEOMETRY` in `scalpGeometry.ts`): e.g. `immediateMaxAtr: 0.4`, `minNetTp1R: 2.5`.
- Static cost model spreads in `liveCostProfile.ts` / `costProfile.ts`.
- Recommendation default expiry `4 * 60 * 60 * 1000` in orchestrator.
- Code-only env knobs missing from `.env.example`: `AUTO_EXECUTION_STAGE`, `AUTO_EXECUTION_DAILY_CAP`, `TRADABILITY_GATE_V1`, calendar/macro/COT flags, `FRED_API_KEY`.

### Residual schema / catalogue

- DB defaults still mention `oanda` origin/source in places (`pg.ts` / catalogue history).
- No in-tree EA; leftover `EaSymbolSpec` type name in lot sizing is naming residue only.

---

## 6. Tool / MCP inventory

**Counts:** `mcp/schemas/tools/*.json` = **55**; `TOOL_CATALOG` = **55**; handlers registered = **55**. No schema/handler gaps.

Read/write from catalog `annotations.readOnlyHint`. UI from `ui?.widget` (registered in `mcp/src/ui/widgets.ts`).

| # | name | R/W | UI widget | Parameters (schema summary) | Handler behavior |
|---|------|-----|-----------|-----------------------------|------------------|
| 1 | `get_account_overview` | read | `account-overview` | `include_live?` | Fan-out status + portfolio + live + trade-mode |
| 2 | `get_trade_readiness` | read | `trade-readiness` | `symbol?`, `market?`, `practice?` | GET trade readiness preflight |
| 3 | `get_agent_capabilities` | read | — | *(none)* | Model info + MCP version + skill names |
| 4 | `get_portfolio` | read | `portfolio` | *(none)* | GET portfolio |
| 5 | `get_open_trades` | read | `open-trades` | *(none)* | GET open trades |
| 6 | `get_trade_lessons` | read | `lessons-card` | `symbol?`, `pattern?`, `limit?`, `recent?` | GET memory lessons |
| 7 | `run_backtest` | write | — | `strategy_id`, `symbol`, `timeframe`, `date_range`, `notional_capital?` | Start backtest job → `job_id` |
| 8 | `jobs_wait` | read | — | `jobs[]` | Poll in-process jobs to terminal |
| 9 | `show_jobs_by_ids` | read | `jobs-report` | `jobs[]` | Lookup job records |
| 10 | `get_strategy_performance` | read | — | `strategy_id`, `symbol?`, `timeframe?` | GET strategy performance |
| 11 | `create_recommendation` | write | `recommendation-card` | plan contract (action, plan_type, levels, rationale, factors, activation… ) | Validate → POST recommendation → auto chart + card |
| 12 | `open_trade` | write | — | `symbol`, `side`, `stop_loss`, `confidence`, `rationale`, optional entry/TP/`dry_run`… | POST trade open (standing_auto) |
| 13 | `close_trade` | write | — | `trade_id?`, `all?`, `dry_run?` | POST trade close |
| 14 | `evaluate_trade` | read | — | `trade_id` | GET trade evaluate |
| 15 | `record_exit_decision` | write | — | `trade_id`, `decision`, `reason`, `new_stop_loss?` | POST exit decision |
| 16 | `request_approval` | write | `approval-card` | side/levels/`dry_run`… | POST approval request |
| 17 | `respond_approval` | write | `approval-card` | `intent_id`, `action`, `dry_run?` | POST approve/reject |
| 18 | `get_pending_approvals` | read | `approval-queue` | *(none)* | GET pending intents |
| 19 | `get_agent_settings` | read | — | *(none)* | GET agent settings |
| 20 | `get_agent_trade_mode` | read | — | *(none)* | GET trade mode |
| 21 | `set_agent_trade_mode` | write | — | `mode`, `confirmed_by_user?` | PATCH trade mode (`actor: mcp`) |
| 22 | `find_similar_cases` | read | — | `symbol`, `interval`, `at_ms?`, `min_similarity?`, `limit?` | POST similar cases |
| 23 | `send_telegram_menu` | write | — | *(none)* | POST telegram menu |
| 24 | `capture_chart_snapshot` | read | — | `symbol`, interval/drawings/layout/`inline_image?`… | Snapshot → inline image |
| 25 | `capture_multi_timeframe_snapshot` | read | — | `symbol`, `timeframes?`, `max_images?`, … | Multi-TF images + numeric context |
| 26 | `get_recommendation_chart` | read | — | `recommendation_id`, `inline_image?` | GET recommendation chart image |
| 27 | `list_agent_skills` | read | — | *(none)* | Local skill metadata |
| 28 | `resolve_agent_skills` | read | — | `request`, intents/locale/market/`max_skills?`… | Local skill selection |
| 29 | `load_agent_skill` | read | — | `name`, `version?` | Local skill body |
| 30 | `get_market_snapshot` | read | `analysis` | `symbol`, `interval?`, `market?` | GET market snapshot |
| 31 | `get_multi_timeframe_snapshot` | read | `analysis` | `symbol`, `intervals?` | GET multi-TF snapshot |
| 32 | `get_market_price` | read | — | `symbol`, `market?` | GET price |
| 33 | `list_instruments` | read | `pair-picker` | `market?`, `q?` | GET instruments |
| 34 | `get_chart_link` | read | — | `symbol` | Build public chart URL (local) |
| 35 | `get_market_context` | read | — | `symbol`, `interval?` | GET market context |
| 36 | `scan_market` | read | `scan-results` | `symbols?`, `interval?` | POST undirected scan |
| 37 | `get_ohlc` | read | — | `symbol`, `interval?`, `limit?`, `cursor?` | GET OHLC |
| 38 | `get_forex_indicators` | read | — | `symbol`, `interval?` | GET indicators |
| 39 | `detect_levels` | read | `levels-report` | `symbol`, `interval?`, `limit?` | GET structure levels |
| 40 | `detect_market_regime` | read | — | `symbol`, `interval?`, `limit?` | GET numeric regime |
| 41 | `connect_mt5` | write | — | `platform`, `server`, `login`, `password` | POST MT connect |
| 42 | `disconnect_mt5` | write | — | *(none)* | DELETE MT connect |
| 43 | `get_mt5_status` | read | — | *(none)* | GET MT status |
| 44 | `get_live_account` | read | `account-overview` | *(none)* | GET live account |
| 45 | `get_account_symbols` | read | — | `q?`, `market?`, `limit?` | GET account symbols |
| 46 | `capture_mt5_chart` | read | — | symbol/interval/levels/drawings/`inline_image?` | Snapshot with drawings |
| 47 | `modify_sl_tp` | write | — | `ticket`, `stop_loss`, `take_profit?`, `dry_run?` | POST modify SL/TP |
| 48 | `cancel_mt5_order` | write | — | `ticket`, `dry_run?` | POST cancel order |
| 49 | `close_partial` | write | — | `ticket`, `lots`, `dry_run?` | POST partial close |
| 50 | `list_chart_layouts` | read | — | *(none)* | GET layout list |
| 51 | `get_chart_state` | read | `live-chart` | `layout_id?` | GET layout state |
| 52 | `show_live_chart` | read | `live-chart` | symbol/interval/layout… | Live-chart widget payload |
| 53 | `draw_on_chart` | write | `live-chart` | drawings/studies/recommendation/`mode`… | POST layout drawings (`dataSource` forced metaapi) |
| 54 | `clear_chart_drawings` | write | — | `layout_id?` | POST layout clear |
| 55 | `run_market_analysis` | write | `analysis` | `symbol?`, `interval?`, `layout_id?`… | Start analyze job → `job_id` |

Handler files: `mcp/src/tools/core.ts` (29), `market.ts` (11), `mt5.ts` (9), `charts.ts` (6).

### Web-only tools (not in MCP catalog)

| name | location |
|------|----------|
| `market_snapshot` | `src/lib/agent/tools/adapters/readOnly.ts` (MCP: `get_market_snapshot`) |
| `active_recommendation_read` | same (no same-named MCP tool) |

The in-app loop is primarily orchestrated specialists + synthesizer, not the full MCP catalog.

---

## Open Questions

1. Whether ops still rely on OANDA scripts (`scripts/vps-force-oanda-data.mjs` etc.) for any production warehouse feeder outside `src/` — not wired through `resolveMarketDataSource`.
2. Whether `confidence: 0` on platform tracker create is intentional (confidence living only on revisions/session) or a latent bug for UI/history consumers.
3. Intended reintroduction of quote-staleness / max-spread enforcement at `executeIntent` after EA removal (adversarial finding #7) — currently absent.
4. Whether `currentSpread` in the tracker will be wired to MetaApi `cost_samples` or remain permanently null.
5. Full list of `AI_PROVIDER` / Anthropic / OpenRouter env names expected in production (used in `llm.ts` but incomplete in `.env.example`).
6. Exact production value of `AUTO_EXECUTION_STAGE` on the VPS (defaults **off** in code; not in `.env.example`).
7. Whether TradingView TA bridge (`TRADINGVIEW_MCP_ENABLED` + `infra/tradingview/`) is used in any live MCP path beyond optional tooling.
8. Residual `RecommendationAction` including `"wait"` vs doctrine that WAIT is not an analytical outcome — API still parses wait for backward compatibility when doctrine flag is off.
9. Scope of `FEATURE_SMART_CHART_AGENT` / `FEATURE_MCP_UNIFIED_ENGINE` rollback paths if either is forced off in ops (defaults on; not fully re-traced for every caller in this audit).
10. Research Swarm presets / process-isolation behavior under load relative to live analysis starvation (documented as an ops concern in `.env.example` comments; not load-tested here).
