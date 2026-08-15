# Migration notes — Lonora gold-only recommendations platform

Living record of the conversion from "multi-pair trading platform with live
broker execution" to "single-instrument (XAUUSD) AI **recommendations-only**
platform". Updated at the end of every phase.

Ground rule followed throughout: **code is the source of truth**, not `.md`
files and not file-header comments. Every claim below was verified by reading
imports and call sites.

---

## Phase 0 — Repo census (no code changes)

### Scale

| Thing | Count |
|---|---|
| Pages (`src/app/**/page.tsx`) | 51 |
| API routes (`src/app/api/**/route.ts`) | 169 |
| MCP tools registered (`mcp/src/tools/*.ts`) | 65 |
| Project `.md` files (excl. node_modules) | ~70 (44 in `docs/`, 10 at root, 14 live assets under `agent/`) |

### Findings that CONTRADICT the plan's premises (verified in code)

These are recorded because acting on the plan's wording without checking would
have broken the build or deleted live functionality.

1. **`src/lib/bridge/` must NOT be deleted wholesale.** The plan flags this as
   conditional; the condition holds. `withBridge` is the auth/rate-limit/
   envelope wrapper used by **18 files**, including surviving market-data
   routes (`api/agent/market/ohlc`, `detect-levels`, `forex-indicators`,
   `detect-regime`). Only `src/lib/bridge/tradeReadiness.ts` is
   execution-only — its sole non-test importer is `api/agent/trade/readiness`,
   which is itself being deleted. **Action: keep `bridge/`, delete only
   `tradeReadiness.ts`.**

2. **The root `agent/` directory is NOT a stale parallel workspace — it is the
   live skill/onboarding CONTENT root.** `src/lib/agent/skills/` is the
   *loader code*; the *content* it loads lives in `agent/workspace/skills/`.
   Proof: `src/lib/agent/skills/defaultRegistry.ts:5-10` resolves
   `agent/workspace/skills` as the registry root, and 4 more runtime readers
   exist (`src/lib/onboardingBootstrap.ts:4`, `mcp/src/tools/core.ts:162,225`,
   `mcp/src/tools/helpers.ts:18`, `mcp/src/onboarding/bootstrap.ts:11`).
   **Action: keep `agent/workspace/skills/` (5 skill packs) and
   `agent/onboarding/bootstrap.en.md`; delete only the genuinely dead parts
   (`agent/scripts/`, `agent/tools/`, `agent/README.md`).** The 14 `.md` files
   under `agent/` are runtime assets, not docs, and are therefore exempt from
   the "only 2 md files survive" rule — noted here so the acceptance check is
   applied to *documentation*, not to loaded content.

3. **`.md` file count is ~70 project files, not ~80**, and the 282 figure a
   naive `find` returns is inflated by `mcp/node_modules`.

### Execution dependency graph (the Phase 1b delete-list)

Core (1,502 lines across 6 files):
`src/lib/execution.ts` (704) · `executionKillSwitch.ts` (204) ·
`approvalFlow.ts` (294) · `executionEnv.ts` (54) · `executionSafety.ts` (43) ·
`recommendations/autoExecutor.ts` (203)

Broker/SDK layers (whole directories):
`src/lib/brokers/` (11 files: metaApiAdapter, metaApiDirect, mt5LocalAdapter,
tradeManagementDispatch, brokerActionApproval, forexBackend, lotSizing,
mt5Retcode, mt5Stops, types, index) · `src/lib/metaapi/` (client, lifecycle,
streaming-stub) · `src/lib/mt5local/` (client) · `src/lib/mt5/` (brokerSearch)
· `infra/mt5/` (Wine container)

Agent-side (532 lines): `agent/agents/executionGuardAgent.ts` (145) ·
`agent/tradeMode.ts` (226) · `agent/portfolioGate.ts` (161) ·
`agent/executionModeBadge.ts`

API routes (37): all of `api/agent/mt/*` (18), `api/agent/trade/*` (5),
`api/agent/approval/*` (3), `api/trades/*` (4), `api/mt/*` (2), `api/mt5/*`
(2), `api/telegram/act`, `api/console/trades-active`

Page: `/awaiting-approval`

4. **`src/lib/ohlc/metaApiOhlc.ts` is misnamed, not dead.** It now contains
   only the pure `isCandleComplete()` helper (the MetaApi fetchers were
   already retired earlier). It has 3 live importers on the *data* side. Per
   the plan: move to `src/lib/ohlc/candleTime.ts`, rewire, then delete.

### Keep-list (protect through every deletion)

- `src/lib/markets/oanda.ts`, `oandaStream.ts`, `marketDataSource.ts`,
  `src/lib/ohlc/fetchOhlc.ts` — the single OANDA candle/quote pipe. Already
  OANDA-only; narrow to gold, never rebuild.
- `src/lib/bridge/` minus `tradeReadiness.ts` (see #1).
- `agent/workspace/skills/`, `agent/onboarding/` (see #2).
- Auth (email/Google/Telegram), recommendations lifecycle, performance
  journal/stats, research-service backtester.

---

## Phase 1 — gold hard-wiring

`src/lib/gold.ts` is the single source of truth: `DATA_SYMBOL` (XAUUSD),
`OANDA_INSTRUMENT` (XAU_USD, used only in `markets/oanda.ts`), pip/point
geometry, the four timeframes, and two guards — `requireGold` (server-side,
throws `GoldOnlyError`) and `coerceToGold` (UI-side, silent). The asymmetry is
deliberate: a non-gold symbol on a data path is a caller bug; a stale bookmark
is not.

Deleted with the multi-pair universe: `pairQuote`, `currencyFlags`, the
instruments/quotes/favourites routes, `SymbolPickerSheet`, `CurrencyFlag`, the
composer's symbol picker, and the crypto/fx branches of `tradingCalendar`
(gold is always `metal`).

## Phase 1b — execution deleted

Full delete-list is in the commit message. Four decisions worth keeping:

1. `ohlc/metaApiOhlc.ts` and `agent/executionModeBadge.ts` were **misnamed, not
   dead** — each held a pure helper used by surviving code. Renamed to
   `ohlc/candleTime.ts` and `agent/envelopeBadge.ts` rather than deleted.
2. `bridge/` survives (18 importers); only `tradeReadiness.ts` was execution-only.
3. `store.ts` lost `createIntent`/`recordTrade`/`resolveBrokerForMarket`. The
   `trade_intents` and `trades` tables keep their data and readers; nothing
   writes them.
4. Phase flag **D** (`AGENT_TRADE_MODE_V1`) is gone — it gated `tradeMode.ts`.

## Phase 1c — docs, voice, orphaned UI

68 of 70 `.md` files deleted. The seven `.md` files under `agent/` are **runtime
assets, not documentation** (canonical identity + 5 skill packs + onboarding
bootstrap), so the "two md files" rule is applied to docs only — see Phase 0
finding #2.

Voice is gone entirely, including `vendor/realtime-voice-component`.

Orphans found by following the deletions outward: `useTradeMode` (still polling
the deleted trade-mode route on a 7s timer), `TopBarAccountStatus`,
`useAccountCapital`, `Mt5LinkCard`, `TradeModePanel`, `LandingPartners` (which
advertised MetaTrader 5 as a partner).

## Phase 2 — three surfaces

`/workspace` and `/chat` swapped roles: `/chat` is now the real chat surface
(it previously redirected to `/workspace`), and `/workspace` redirects to it.
Nav is exactly `["/chat", "/recommendations", "/performance"]`.

Deleted: dashboard, market, chart, command, signals, journal, statistics,
reports, plan, blog, docs, trades, agent, onboarding, complete-profile, the
`/p/[slug]` CMS pages, and the trader console pages (`/console`,
`/console/{account,mcp,pages,support,risk,connect,recommendations,chats}`).

**Two deliberate departures from the plan's wording**, both recorded rather
than silently taken:

1. **The admin panel stays** (`/console/platform`). The plan's Phase 2 says to
   delete "console", but its own FAQ requires admin-only configuration ("News
   block window? Platform config, admin-only"). The FAQ's surviving-page list
   is about trader surfaces; deleting the admin panel would remove the only
   place that config can live.
2. **Billing is flag-gated, not deleted** — exactly the fallback the FAQ
   allows ("delete if clean, else hide behind `FEATURES.billing=false`"). It is
   not clean: `getEntitlementForUser` gates chat access itself. `FEATURES.billing`
   defaults **off** and `/pricing`, `/subscribe`, `/console/billing` redirect
   when it is.

Not yet done from Phase 2: the settings drawer is not merged into chat.
Settings still live on their own pages, reachable from the profile popover
(off-nav), which is where they already lived.
