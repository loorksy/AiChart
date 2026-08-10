# Lonora feature inventory & three-tier plan proposal (N3)

Docs-only. Sourced from this repository’s routes, MCP catalog, billing modules, and agent feature flags — **not** from the marketing/pricing page. Prices and feature gates in `web/src/lib/billing/tiers.ts` are **unchanged** by this note; the three-tier section is a product proposal for later decisions.

Measured at commit tip of the Lonora Phases 2–8 branch.

---

## 1. Surface inventory (from code)

### 1.1 Web API routes — 160 `route.ts` files under `web/src/app/api`

| Area | Routes | Role |
|---|---:|---|
| `agent/*` | 53 | Bridge + workspace agent: chat, market, chart, MT, approvals, trades, voice, recommendations |
| `admin/*` | 25 | Ops: users, billing, config, model prices, MCP auth, diagnostics |
| `recommendations/*` | 9 | Recommendation CRUD / lifecycle |
| `cron/*` | 8 | Warehouse, monitor, case-memory, daily summary, event monitor |
| `auth/*` | 7 | Session, register, Google, Telegram link |
| `trades/*` | 5 | Trade intents / approval responses |
| `market/*`, `instruments/*`, `mt*`, `billing/*`, other | rest | Quotes, instruments, MetaApi status, Stripe, alerts, skills, DNA, shadow trader |

Notable trader-facing routes added or reshaped in Phases 2–7:

- Instruments + favourites + live quotes (`/api/instruments`, `/api/instruments/quotes`, `/api/instruments/favourites`)
- Tick SSE for cloud charts (`/api/market/ticks`)
- Chart capture / recommendation PNG (`/api/agent/chart/*`, `/api/chart-image/[id]`)
- Billing balance (`/api/billing/balance`) vs MT equity (`/api/mt/status`)

Workspace home is `/workspace` (308 from `/console`).

### 1.2 MCP tool catalog — 55 tools

From `mcp/src/tools/schemas/*` → `TOOL_CATALOG` (`core` 29 + `market` 11 + `mt5` 9 + `charts` 6). Schema JSON count under `mcp/schemas/tools/` matches.

| Domain | Count | Examples |
|---|---:|---|
| Core | 29 | `get_agent_capabilities`, `get_account_overview`, `create_recommendation`, `request_approval` / `respond_approval`, `open_trade`, `scan_market`, `run_backtest`, skills, jobs |
| Market | 11 | `get_market_snapshot`, `get_ohlc`, `get_market_price`, `list_instruments`, `detect_levels`, `run_market_analysis` |
| MT5 | 9 | `connect_mt5`, `get_live_account`, `get_mt5_status`, `get_account_symbols`, `capture_mt5_chart` |
| Charts | 6 | `show_live_chart`, `draw_on_chart`, `capture_chart_snapshot`, `capture_multi_timeframe_snapshot` |

Execution truth: chart / MCP buy-sell paths that matter for operators go through **approval** (`request_approval` → operator confirm → `respond_approval` / web intents). Direct `open_trade` remains a tool for authorized automation stages, not the chart ticket.

### 1.3 Agent capability flags (`web/src/lib/agent/featureFlags.ts`)

Default-on unless noted:

| Flag | Default | What it gates |
|---|---|---|
| `FEATURE_AGENT_SKILLS` | on | Skill discovery / load |
| `AGENT_CONTEXT_V2` | on | Persisted chat context |
| `AGENT_RUN_TRACE_V1` | on | Run/step audit |
| `VISION_DECISION_V1` | on | Chart images in decision calls |
| `CASE_MEMORY_V1` | on | Historical case evidence (frozen — see §1.3.1) |
| `AGENT_DOCTRINE_V3` | on | Three-layer doctrine |
| `REC_REVISIONS_V1` | on | Effective revisions |
| `REC_LIFECYCLE_ALERTS_V1` | on | Lifecycle Telegram/in-app delivery |
| `AGENT_TRADE_MODE_V1` | on | Advisory / auto mode state (auto *placement* still staged separately) |
| `PATTERN_ATLAS_V1` | on | Pattern atlas skills |
| `EVIDENCE_PIPELINE_V2` | on | Session costs / statistical evidence |
| `PERFORMANCE_JOURNAL_V1` | (see flags file) | Journal phase |
| `AGENT_MEMORY_WRITE_V1` | **off** | Conservative memory writes |

#### 1.3.1 Candle warehouse removed

The persistent candle warehouse (`market_candles`), `FEATURE_CANDLE_WAREHOUSE`,
`BOUNDED_COLD_START_V1`, the mass-backtest pipeline (`run_backtest`,
`STRATEGY_PIPELINE_*`), and Deep Analysis (`DEEP_RESEARCH_V2`, Phase I) were
deleted together: every candle now comes live from the user's own linked
MetaTrader account on every call, with no server-side store, cache, or
per-request timeout in between. Backtest and Deep Analysis needed a bulk
historical export that only the warehouse could serve cheaply and cannot be
rebuilt on live-only data. `CASE_MEMORY_V1` (Phase G) survives read-only: the
`market_cases` table keeps answering `find_similar_cases`, but nothing indexes
new cases into it anymore.

Session-start MCP sequence (steering): `get_agent_capabilities` → `get_account_overview` → `get_agent_trade_mode`.

### 1.4 Billing & cost floors (code facts)

**Public tier table** (`web/src/lib/billing/tiers.ts`) — four rows today:

| Tier id | Price USD | Included credits (retail USD) | mt5Link | liveExecution | voice | scalpEngine |
|---|---:|---:|---|---|---|---|
| `lite` | 79 | 45 | no | no | no | no |
| `plus` | 149 | 90 | yes | no | no | no |
| `pro` | 249 | 160 | yes | yes | yes | yes |
| `promax` | 399 | 275 | yes | yes | yes | yes (+ prioritySupport) |

Model allowlists tighten on lower tiers; `promax` allowlist is empty (= all catalogue models).

**Usage metering** (`web/src/lib/billing/usageMeter.ts`):

- Seed provider prices (USD / 1M tokens), e.g. `gpt-5.6-luna` 0.2/1.2, `gpt-5.6-terra` 2/12, `gpt-5.6-sol` 5/30, `claude-haiku-4-5` 1/5, `claude-sonnet-5` 3/15, `claude-opus-5` 5/25.
- Retail burn = provider cost × `BILLING_RETAIL_MULTIPLIER` (platform_config; placeholder `1.0`, minimum enforced `1`).

**MetaApi deploy hours** (`web/src/lib/metaapi/lifecycle.ts` + platform_config):

- `METAAPI_HOURLY_USD` placeholder / fallback **`0.02`**.
- Charged as hours × hourly × retail multiplier against the user’s credits while a deploy session is open.
- Floor examples at multiplier `1.0`:
  - 8 h/day × 22 days ≈ **$3.52**/mo MetaApi
  - 24×7 ≈ **$14.40**/mo MetaApi  
  At multiplier `1.5` those floors scale to ≈ **$5.28** / **$21.60**.

Credits are the shared wallet for LLM + MetaApi retail burn; subscription price is not the same number as included credits (margin room sits in the price−credits gap and the multiplier).

### 1.5 Market data pipes (operator-visible)

| Source | When | Notes |
|---|---|---|
| OANDA (“platform feed”) | No linked cloud MT account | Spreads/book labeled platform |
| MetaApi broker account | Cloud MT linked | Broker spelling preserved outbound; UI/tools must name the book |

Resolver: `resolveMarketDataSource`. Broker catalogue + favourites + live pair-card quotes are first-class (Phases 2–5).

---

## 2. Capability map (what the product actually does)

Grouped for packaging — not a pricing page copy.

1. **Observe** — workspace chat, OANDA/platform OHLC & quotes, recommendations, Telegram text/PNG cards, skills, backtests, journal/research flags.
2. **Connect** — MetaApi link, broker symbol catalogue, live ticks/spread on chart, MT equity in chrome, favourites in broker spelling, MCP MT5 status/symbols.
3. **Decide** — create/revise recommendations, lifecycle alerts, evidence/doctrine, deep research, vision-on-chart.
4. **Approve** — `request_approval` / chart buy-sell ticket / Telegram buttons → operator confirm (never silent chart→market for advisory).
5. **Execute** — live order placement when trade mode + staging allow; modify/close; portfolio tools.
6. **Bill** — Stripe tiers, credit ledger, usage events, MetaApi hourly burn, dual balances (subscription credit vs MT equity).

---

## 3. Three-tier plan proposal (docs only)

Collapse the four coded tiers into **three** sellable packages that still clear the cost floors above. Numbers below are **proposal** targets for a later pricing change; they deliberately sit near today’s coded floors so a migration is a rename/merge, not a rewrite.

### Cost floor used for the proposal

Assume a cautious operator month:

- LLM retail (mixed luna/terra analyses + chat): **~$25–60** depending on depth
- MetaApi when linked: **~$4–15** at `$0.02/h` × multiplier `1.0`
- Combined variable floor for a connected heavy user: **~$40–75** before margin

Included credits must clear that floor on Connect/Execute; Observe can stay leaner (no MetaApi).

### Proposed three tiers

| Proposed package | Maps from today’s code | Suggested price band | Suggested included credits | Gates |
|---|---|---|---|---|
| **Observe** | today’s `lite` | **$79** (keep) | **≥ $45** (keep) | Platform feed only; no `mt5Link`; advisory chat + recommendations + Telegram; narrow models (luna/haiku) |
| **Connect** | today’s `plus` | **$149** (keep) | **≥ $90** (keep; clears MetaApi + moderate LLM) | `mt5Link`; live broker quotes/ticks/catalogue; **no** `liveExecution`; terra/sonnet allowed; approval-only trading |
| **Execute** | merge `pro` + `promax` | **$249–399** as two SKUs *or* single **$299** mid | **≥ $160** base; **$275** for “Max” add-on credits/support | `liveExecution` + voice + scalp; full/near-full model catalogue; priority support only on the Max credit SKU |

**Recommendation:** ship **three names** in marketing (Observe / Connect / Execute) while keeping four Stripe price IDs temporarily if Max remains a credit+support upsell — or truly merge Max into Execute with a higher included-credit SKU. Do **not** put MetaApi-unlimited 24×7 inside Observe; the hourly meter makes that a Connect+ floor.

### What not to do in code yet

- Do not edit `tiers.ts`, Stripe price IDs, or the pricing page from this document.
- Do not weaken approval for Connect; Execute still respects trade-mode staging.
- Quote subscription **credit** and MT **equity** as separate balances in every package that shows money (already wired in shell).

---

## 4. Traceability

| Claim | Source |
|---|---|
| 160 API routes | `find web/src/app/api -name route.ts \| wc -l` |
| 55 MCP tools | `mcp/schemas/tools/*.json`, `TOOL_CATALOG` |
| Domain split 29/11/9/6 | `mcp/src/tools/schemas/{core,market,mt5,charts}Schemas.ts` |
| Tier prices & flags | `web/src/lib/billing/tiers.ts` |
| Token seed prices & retail multiplier | `web/src/lib/billing/usageMeter.ts`, `BILLING_RETAIL_MULTIPLIER` |
| MetaApi hourly floor | `METAAPI_HOURLY_USD` default `0.02` in lifecycle + platformConfig |
| Agent flags | `web/src/lib/agent/featureFlags.ts` |

When code drifts, re-run the counts above and update this file — do not sync from the pricing UI.
