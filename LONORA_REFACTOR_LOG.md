# Lonora refactor log — symbol universe, OANDA-only data, MCP-scoped execution, per-symbol profiles

Implements the four architectural changes requested for this repo. Executed
change-by-change (1 → 2 → 3 → 4), with `tsc --noEmit` and the relevant test
suites run after each change before moving to the next. Full-suite regression
check (`npm run test:unit`) run after every change and again at the end,
diffed against a fresh baseline (`git stash` + same invocation) — see
"Verification" at the bottom.

---

## Change 1 — Restrict the symbol universe to exactly 20 instruments

**New file:** none — the 20-symbol list lives in `src/lib/markets/forexInstruments.ts`
(rewritten, see below), not a new file, because that was already the
platform's baseline-instrument list and its `TRADABLE_SYMBOLS` export is now
imported everywhere else needs the universe.

**`src/lib/markets/forexInstruments.ts`** — `FOREX_INSTRUMENTS` replaced
with exactly the 20 requested symbols (was 22, missing `BTCUSD`/`AUDCHF`/
`GBPNZD`/`NZDJPY`, carrying 7 non-requested ones — `XAGUSD`, `USOIL`, `UKOIL`,
`US30`, `US500`, `NAS100`, `GER40`). Added `group: "crypto"` for `BTCUSD`.
Exports `TRADABLE_SYMBOLS` (the fixed list) and `CANDLE_SYNC_SYMBOLS` (an
alias, kept for naming continuity with the requested env-var name — **there
is no live candle-sync/warehouse job in this codebase to wire it into**; the
candle warehouse and its sync jobs were deleted in the immediately-preceding
commit (`e87174d`), so this constant today backs only the scan resolver and
symbol-surfacing endpoints below. Flagged, not silently skipped.

**Hard-allowlist enforcement added at every "all symbols" surface and at the
true OHLC chokepoint:**
- `src/lib/allowedAssets.server.ts` — `resolveScanAssetsForMarket` now
  intersects every branch (watchlist, explicit allow-list, open-policy
  catalogue fallback) against `TRADABLE_SYMBOLS`; the broker-catalogue
  fallback (`listBrokerCatalogue`) was removed since the universe is fixed,
  not broker-catalogue-derived.
- `src/lib/ohlc/fetchOhlc.ts` — **the actual single chokepoint** (every
  analyze/detect-levels/indicators/klines/snapshot/MCP `get_ohlc` call goes
  through this one function): rejects any symbol outside the 20 with a clear
  Arabic error, before any data fetch. This is the strongest enforcement
  point in the whole change — it can't be bypassed by a route forgetting to
  filter.
- `src/app/api/instruments/route.ts` — rewritten (see Change 2) to serve the
  fixed list directly; no filtering needed since there's nothing else to filter.
- `src/app/api/instruments/quotes/route.ts` — incoming `symbols` query param
  filtered against the allowlist before any quote fetch.
- `src/app/api/agent/mt/symbols/route.ts` (MCP `get_account_symbols`) —
  broker's live symbol list now filtered to the 20-symbol universe.
  **Interpretation call, flagged:** this tool's own docstring says "not just
  the watchlist — any tradable pair," i.e. it was designed to be broader
  than analysis scope. Restricted it anyway for consistency — since analysis
  is now hard-capped to 20 symbols, letting execution/account-visibility
  reference a 21st symbol nothing was ever analyzed against seemed like the
  wrong default. If a future requirement needs the account tool to show
  everything, this is the line to revert.
- `src/app/api/agent/market/scan/route.ts` (MCP `scan_market`) — the
  caller-supplied `symbols` array (used when a caller passes explicit
  symbols instead of the settings-driven watchlist) was **not** filtered
  before this change — a real gap where an explicit list bypassed the
  allowlist entirely. Fixed.

---

## Change 2 — Market data: OANDA only, zero data from the MT5/Exness account

**Scope correction made mid-task, confirmed with the requester:** the
original instruction paired this with a literal Change 3 ("MCP only" for
execution) that would have broken 3 of 4 legitimate execution callers — see
Change 3 below for the resolution. Change 2 itself proceeded as specified.

### New files
- **`src/lib/markets/oanda.ts`** — the OANDA v20 REST adapter. Restored from
  git history (`git show 414647b^:web/src/lib/markets/oanda.ts` — it had
  been fully deleted by an earlier commit this session that made the user's
  own MetaTrader account the sole data pipe) and re-adapted to the current
  `src/lib/markets/` path. One platform-owned token/account
  (`OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`, `OANDA_ENV`), not per-user.
  Exports `fetchOandaCandles`, `fetchOandaPricing`, `fetchOandaInstruments`,
  symbol mapping (`toOandaInstrument`/`fromOandaInstrument`,
  `EURUSD ↔ EUR_USD`), `oandaConfigured()`.
- **`src/lib/markets/oandaStream.ts`** — replaces the retired MetaApi tick
  stream. OANDA's v20 streaming endpoint takes its instrument list once at
  connect time (no per-symbol subscribe/unsubscribe like MetaApi had), so
  this opens **one shared, platform-level connection covering all 20
  symbols permanently** (started on first SSE subscriber, torn down when
  the last one across all symbols disconnects, with reconnect/backoff on
  drop) and fans ticks out per-symbol to however many SSE listeners are
  open — same shape as the retired `metaapi/streaming.ts`, but shared across
  all users instead of one connection per user.

### Rewired to OANDA (previously read the user's own MT5/MetaApi account)
- **`src/lib/markets/marketDataSource.ts`** — `MarketDataSource` collapsed to
  `"oanda"` only; `resolveMarketDataSource`/`marketDataAvailability` no
  longer take or need a `userId` for data purposes (kept as an ignored
  param for call-site compatibility) — availability is now "is OANDA
  configured," a platform fact, not "has this user linked an account."
- **`src/lib/ohlc/fetchOhlc.ts`** — the chokepoint's `fetchAccountCandles`
  (MetaApi cloud history + mt5local bridge branches) replaced entirely with
  `fetchOandaCandles`. `OhlcSource` collapsed to `"oanda"`.
- **`src/lib/markets/forexPrice.ts`** (`getForexLiveQuote`/`getForexLiveMid`)
  — now calls `fetchOandaPricing`, no account/RPC lookup.
- **`src/app/api/market/forex-price/route.ts`** — `cloudQuote` (MetaApi RPC)
  replaced with `oandaQuote` (OANDA pricing); no-link gate removed.
- **`src/app/api/instruments/quotes/route.ts`** — `liveMid` now calls
  `fetchOandaPricing` instead of the user's RPC connection.
- **`src/app/api/instruments/route.ts`** — fully rewritten. Previously: live
  `MetaApi getSymbols()` when linked, else a broker-seeded DB catalogue.
  Now: serves `FOREX_INSTRUMENTS` (the fixed 20) directly — no account, no
  DB catalogue lookup, same answer for every caller.
- **`src/app/api/market/klines/route.ts`** — `requires_link`/MT5-link gate
  removed; now gates only on `oandaConfigured()`. Works for guests.
- **`src/app/api/market/ticks/route.ts`** — `subscribeSymbolTicks` (MetaApi)
  replaced with `subscribeOandaSymbolTicks`; per-user account/link check
  removed, replaced with a tradable-symbol check.
- **`src/app/api/agent/mt/tick/route.ts`** (MCP `get_current_tick`) — was a
  direct `conn.getTick()` call against the user's MetaApi connection; now
  calls `fetchOandaPricing`.
- **`src/lib/chartSnapshot.ts`** — the `mt5local`-branch direct `mt5Rates()`
  call removed; both branches now go through `fetchOhlc` (OANDA).
- **`src/lib/markets/forexSnapshot.ts`**, **`src/lib/markets/index.ts`** —
  `OhlcSource`/`MarketDataSource`-typed defaults and book label updated
  (`"metaapi"` → `"oanda"`; book label `"broker_cloud"` → `"oanda"`).
- **`src/lib/agent/envelopePresentation.ts`** — the mandatory
  data-source-naming line in every analysis summary said "MetaApi broker
  cloud feed" regardless of actual source; now says "OANDA platform feed."
  This was a real mislabeling bug this migration would otherwise have left
  in place silently (the `source` param was already typed `"oanda"` but the
  hardcoded string still said MetaApi).
- Frontend: `src/components/agent/DataSourceChoice.tsx`,
  `src/components/agent/SymbolPickerSheet.tsx`,
  `src/components/SmartChartWorkspace.tsx`, `src/components/chart/TvChart.tsx`,
  `src/components/chart/ChartChrome.tsx`, `src/lib/agent/types.ts`,
  `src/lib/opportunityScan.ts`, `src/lib/agent/orchestrator.ts`,
  `src/lib/agent/drawingCommands/handleDrawingCommand.ts`,
  `src/app/api/agent/chart/layout/route.ts`,
  `src/app/api/agent/chat/stream/route.ts`,
  `src/app/api/agent/market/analyze/route.ts`, `mcp/src/tools/charts.ts` —
  all `"metaapi"`-literal `dataSource`/`source` type unions and default
  values updated to `"oanda"`. The `DataSourceMenuButton` chip's "unlinked →
  link CTA" behavior was replaced with an "unavailable" state (no link,
  since OANDA being unconfigured is a platform issue, not something a
  user's own account link fixes) — i18n keys in `ar.ts`/`en.ts` updated to
  match.

### Deleted (Bucket A — market-data functions with zero remaining callers,
### per "delete/disable any function returning a tick/candle/quote meant
### for analysis/display")
- **`src/lib/mt5local/client.ts`** — removed `mt5Price` (already dead, zero
  callers even before this change), `mt5Rates` (its only two callers,
  `fetchOhlc.ts` and `chartSnapshot.ts`, were both rewired above), and
  `mt5Positions` (already dead). **Kept**: `mt5Connect`, `mt5Status`,
  `mt5Spec` (execution-path lot sizing), `mt5Order`, `mt5Close` — Bucket B,
  explicitly out of scope.
- **`src/lib/ohlc/metaApiOhlc.ts`** — removed `fetchMetaApiOhlc`,
  `fetchMetaApiOhlcRange`, `getHistoryAccount`, `fetchPage` (all now
  orphaned once `fetchOhlc.ts` stopped importing them). **Kept**:
  `isCandleComplete` — pure arithmetic (source-agnostic), still imported by
  3 unrelated files (recommendation route, `recommendationTracker.ts`,
  orchestrator).
- **`src/lib/metaapi/streaming.ts`** — gutted to a `clearStreamingCache`
  no-op stub. The real tick-subscription/fan-out logic (`subscribeSymbolTicks`,
  `ensureStream`, `recordCostSample`, `tickTimeMs`) had zero callers once
  the ticks route was rewired to `oandaStream.ts`. **`clearStreamingCache`
  kept as a stub** because `metaapi/client.ts`'s `clearRpcCache` (execution
  lifecycle code, out of scope) still calls it on every account
  unlink/re-link — there's nothing left to clear, but touching that call
  site would have meant touching execution-adjacent code for a data-path
  retirement.

### Deliberately NOT ported — flagged, not silently dropped
- **`src/lib/accountProfile.ts`** (`cloudSpread`) — used to read the user's
  own MetaApi bid/ask to show "your account's spread" in the account
  profile panel. **Retired outright, not switched to OANDA.** Reasoning:
  the field is explicitly labeled as the account's own spread ("what an
  order actually crosses"); feeding it OANDA's spread instead would silently
  mislabel a different venue's number under a "your account" label — the
  opposite of the honesty this migration is supposed to produce. Fields now
  report `null`/`false` (absent, not substituted).
- **Live-tick cost-sample recording** (`cost_samples` table, feeding
  `strategies/liveCostProfile.ts`'s session spread ladder) — its own header
  comment explicitly says it was "designed to measure what this operator's
  broker actually charges." That data source (per-user live ticks) no
  longer exists after this migration. **Not re-implemented against OANDA**,
  for the same honesty reason as above — labeling OANDA's spread as "this
  operator's broker" would violate the module's own stated design
  principle. The module already has an honest, pre-existing fallback path
  (`source: "static_model"`, used whenever there aren't enough live
  samples) — it now always takes that path instead of a live one. No code
  change was needed there; this is a documented consequence, not a gap.

### Config wiring
- **`src/lib/platformConfig.ts`** — added `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID`,
  `OANDA_ENV` to `PLATFORM_CONFIG_FIELDS` (the admin-panel-settable list).
  These were being read via `getPlatformValue()` in the restored
  `markets/oanda.ts` but had no field declared — the exact "unreachable
  config key" bug class `platformConfigCoverage.test.ts` exists to catch.
  **This fixed a pre-existing failure in that test** (it was already
  failing before this change, for the same reason, on `METAAPI_TOKEN`-era
  keys — confirmed via `git stash` diff of the full test run).
- **`.env.example`** — comments corrected: OANDA section now accurately
  describes the platform-level, no-link-required data role;
  `FOREX_DATA_SOURCE=oanda` removed (it was never read by any code — dead
  documentation for a toggle that doesn't exist); a misleading comment
  implying `OANDA_ENV` affects live-execution risk decisions was corrected
  (it doesn't and must never — see the `executionKillSwitch.test.ts`
  regression test, untouched, which exists specifically to pin this).

### Tests updated
- **`src/lib/markets/__tests__/dataSourceChoosable.test.ts`** — was a
  negative-assertion test guarding the *removal* of OANDA (`!/oanda/i.test(...)`).
  Fully rewritten to assert the new reality: `resolveMarketDataSource`
  always answers `"oanda"` regardless of user/link state, and the resolver
  no longer reads `getMtAccount` at all.
- **`src/lib/__tests__/backendDataAndExecutionParity.test.ts`** — its
  "market data source" describe block (unrelated "execution environment"
  block left untouched) rewritten from "unlinked → not connected" to
  "data is served regardless of link state."
- **`src/components/__tests__/smartChartWorkspaceInit.test.ts`** — updated
  its source-level pin from `useState<MarketDataSource>("metaapi")` to
  `"oanda"`; dropped the now-inapplicable "no trace of oanda" assertion.
- **`src/app/api/market/forex-price/__tests__/brokerSymbolResolve.test.ts`**
  — fully rewritten; the route it pins no longer has a `cloudQuote`/
  `resolveBrokerSymbol` function to test.
- **`src/lib/display/__tests__/numericDisplay.test.ts`** — assertions
  updated from `/MetaApi broker cloud feed/i` to `/OANDA platform feed/i`
  to match the mislabeling fix in `envelopePresentation.ts`.
- **`src/lib/ohlc/__tests__/indicators.test.ts`**,
  **`src/lib/agent/__tests__/userSafeOutbound.test.ts`** — literal
  `"metaapi"` source-parameter values updated to `"oanda"`.
- **Left untouched, deliberately**: `src/lib/agent/__tests__/intentRouter.test.ts`
  and `src/lib/agent/__tests__/errorTaxonomy.test.ts` (both assert outbound
  text never leaks `OANDA|MetaApi` regardless of provider — a
  provider-agnostic invariant, still correct); `src/lib/__tests__/executionKillSwitch.test.ts`
  (deliberately keeps `OANDA_ENV` in its env matrix as a regression guard
  that a data-era env var must never gate live-money execution — more
  relevant now that `OANDA_ENV` is wired again, not less).

---

## Change 3 — Execution reachable only through authorized paths (reinterpreted)

**The literal instruction ("reject any call not authenticated as the MCP
Bridge") was not implemented as written** — confirmed with the requester
before touching this code. `executeIntent` has exactly 4 legitimate callers,
already enforced by a static source-grep test
(`executionAuthorizationPaths.test.ts`):

1. `src/app/api/agent/trade/open/route.ts` — MCP bridge (service token + HMAC).
2. `src/lib/recommendations/autoExecutor.ts` — the standing-authorization
   sweep, triggered by a cron route (`CRON_SECRET`) **or** an in-process
   `setInterval` scheduler with **no HTTP request at all** — there is no
   bridge token to check on this path, ever.
3. `src/lib/approvalFlow.ts` — reached from both the MCP approval-respond
   route (bridge-authenticated) **and** the Telegram signed-URL action route
   (its own independent HMAC, `verifySignedAction`, not the MCP bridge token).
4. `src/app/api/trades/intents/[id]/route.ts` — browser/session-authenticated.

A literal "MCP bridge only" gate would have silently broken auto-execution,
Telegram approval, and the dashboard-approval flow — three of the four
authorized paths. Implemented instead: **the same concept the instruction
asked for (verify the caller, don't just trust it), generalized across all
four legitimate callers** rather than only the one that happens to carry an
HTTP bridge token.

### `src/lib/execution.ts`
- Added `ExecutionCallerContext = "mcp_bridge" | "auto_executor" |
  "telegram_approval" | "dashboard_approval"` and `AUTHORIZED_CALLER_CONTEXTS`
  (the runtime source of truth, mirroring the static test's `AUTHORIZED_CALLERS`).
- `ExecuteIntentOptions.callerContext` is **required**, and `executeIntent`'s
  `options` parameter itself was changed from optional to required — a
  caller can no longer skip declaring its identity by omitting the whole
  options object. This makes the check exhaustive at **compile time**: every
  existing and future call site must declare which of the four it is, or
  the build fails.
- At runtime, the very first thing `executeIntent` does — before locking,
  before touching the intent, before any broker call — is verify
  `options.callerContext` is one of the four literals. An invalid/forged
  value (reachable only from a JS caller or an `any` cast bypassing the
  type system) is refused immediately, logged to `audit_logs` via
  `logAudit("execution_unauthorized_caller", ...)`, and returns
  `errorCode: "unauthorized_caller"` — never silently defaulted to an
  authorized context.
- `executionKillSwitch.ts` and `approvalFlow.ts`'s approval/rejection logic
  were **not touched** beyond threading the new required field through —
  per the original instruction, this narrows *who* can reach `executeIntent`,
  not the approval/kill-switch logic itself.
- `get_account_state`-equivalent reads (`getRiskBudget`'s `getMtAccountMeta`
  call, `evaluatePortfolioForIntent`'s `listOpenTrades`) — unchanged, per
  the original instruction's explicit carve-out.

### Every call site updated to declare its context
- `src/app/api/agent/trade/open/route.ts` → `"mcp_bridge"`.
- `src/lib/recommendations/autoExecutor.ts` → `"auto_executor"`.
- `src/lib/approvalFlow.ts`'s `respondToApproval` gained a 4th parameter,
  `channel: "mcp_bridge" | "telegram_approval"` (default `"mcp_bridge"`),
  threaded into `executeIntent`'s `callerContext`. Its two callers updated:
  `src/app/api/agent/approval/respond/route.ts` passes `"mcp_bridge"`;
  `src/app/api/telegram/act/route.ts` passes `"telegram_approval"`.
- `src/app/api/trades/intents/[id]/route.ts` (both the SSE and non-SSE
  branches) → `"dashboard_approval"`.

### Tests
- **`src/lib/__tests__/executionAuthorizationPaths.test.ts`** — new `it`
  block pins that the runtime guard exists (not just the source-grep
  allowlist): asserts `AUTHORIZED_CALLER_CONTEXTS`, the `options?.callerContext`
  check, the `"unauthorized_caller"` error code, and that `options` is
  required (not optional) all appear in `execution.ts`.
- **`src/lib/__tests__/executionSourceEnforcement.test.ts`** — new describe
  block, DB-backed: (a) a forged/invalid `callerContext` is refused with
  `errorCode: "unauthorized_caller"` *before* the intent gets locked (a
  legitimate retry on the same intent right after isn't blocked as
  `intent_busy`); (b) all four documented contexts are accepted.
- The ~19 pre-existing direct `executeIntent(...)` calls across
  `executionMatrix.test.ts`, `executionSourceEnforcement.test.ts`, and
  `executionStageAndApproval.test.ts` were updated to pass
  `callerContext: "dashboard_approval"` (they're testing the
  authorization-source/approval gates downstream of the caller check, not
  the caller check itself, so any valid context is correct there).

---

## Change 4 — Per-symbol agent profiles on one shared engine

**Scope correction, confirmed with the requester:** `STRATEGY_PIPELINE_SYMBOLS`
and `STRATEGY_PIPELINE_BATCH` do not exist in this codebase — they were
deleted intentionally, together with `run_backtest` and the candle
warehouse, in the immediately-preceding commit (`e87174d`), specifically
because a symbol-list-driven batch pipeline needs the bulk historical data
that warehouse used to serve and that cannot be rebuilt on live-only data.
Per the requester's decision, this change restricts the universe via
`CANDLE_SYNC_SYMBOLS` (Change 1) only — the batch pipeline was **not**
rebuilt.

**No fork of `src/lib/agent/` was created.** One orchestrator, one bias
engine, one strategy catalog — parameterized by a new data map.

### New files
- **`src/lib/agent/symbolProfiles.ts`** — the per-symbol profile map, one
  entry per instrument in the fixed 20-symbol universe (`getSymbolProfile`
  canonicalizes via `forexCanonicalKey` first, so broker-suffixed spellings
  like `XAUUSDm` resolve to the same profile as `XAUUSD` — same
  canonicalize-then-lookup shape as the existing `strategies/liveCostProfile.ts`).
  Each profile carries:
  - `instrumentClass` (`fx_major` / `fx_minor` / `metal` / `crypto`).
  - `bias: { lookbackBars, changeThreshold }` — see below.
  - `strategyFamilies` — a subset of `strategies/catalogGen.ts`'s family
    tags this symbol is eligible for (all 11 families for every forex/metal
    symbol; all except `session_range` for `BTCUSD`, since a 24/7 market has
    no forex trading-session structure for that family to key off).
  - `catalogEntriesForSymbolAndTimeframe(symbol, timeframe)` — composes
    `strategyFamiliesForSymbol` with the existing
    `catalogEntriesForTimeframe`, giving a ready-to-use, symbol-aware
    filtered catalog. **Not wired into a live call site** — the backtest
    catalog (`catalogGen.ts`) has zero production callers today (confirmed:
    only its own test imports `catalogEntriesForTimeframe`), because the
    batch pipeline that would have run it was the one deleted alongside the
    warehouse. This function exists as the ready seam for whenever that
    pipeline is rebuilt, per the requester's decision not to rebuild it now.
  - `calibratedConfidenceForSymbol(userId, symbol, strategyId, timeframe)` —
    a thin, symbol-profile-aware wrapper around the **existing**
    `strategies/evidence.ts` `getStrategyDeployment`, which is already keyed
    by `(user, strategy, symbol, timeframe)`. **No new confidence store was
    built.** `PERFORMANCE_JOURNAL_V1` (`recommendations/performanceJournal.ts`)
    was checked and confirmed to be a *global/aggregate* operator journal,
    not a per-symbol confidence source — it is correctly not used here.
- **`src/lib/agent/__tests__/symbolProfiles.test.ts`** — 7 tests: full
  1:1 coverage of the 20-symbol universe (fails loudly if a symbol is
  added to `forexInstruments.ts` without a matching profile, or vice
  versa), suffix-canonicalization, out-of-universe → `null`, bias
  thresholds widen major → minor → metal → crypto, fallback for an
  unprofiled symbol, and that `catalogEntriesForSymbolAndTimeframe` never
  returns a family outside the symbol's profile.

### Wired into the live orchestrator
- **`src/lib/agent/marketContext/detectors.ts`** — `biasFromCandles` gained
  optional `{ lookbackBars, changeThreshold }` params (defaulting to the
  original 50-bar/0.3% values — fully backward compatible for any caller
  that doesn't pass them). Previously **hardcoded identically for every
  symbol**, including gold and crypto, whose typical % swings over 50 bars
  run well above a forex major's — meaning the flat 0.3% threshold was
  systematically too tight for those instruments (prone to flipping
  direction on ordinary noise).
- **`src/lib/agent/agents/multiTimeframeAgent.ts`** — now resolves
  `biasParamsForSymbol(market.symbol)` once per run and passes it into all
  three `biasFromCandles` calls (current/higher/daily timeframe bias). This
  is the one and only live wiring point for the bias half of the profile —
  found via the orchestrator trace: `runUnifiedChartAgentInner` is already
  single-symbol-scoped from the moment `chartContext.symbol` is known, and
  this agent is where the bias computation actually happens downstream of it.

### Explicitly not built — matches the product's own stated doctrine
No committee/veto logic exists anywhere in this codebase, and none was
added. `systemPrompt.ts` and `finalDecisionSynthesizer.ts` explicitly state
research/evidence "never veto, flip, or invalidate" the model's final
opinion; `evaluate_trade` (MCP tool) takes only `trade_id`, is symbol-aware
only by indirection through the stored trade row, and has no multi-evaluator
structure to make symbol-aware. Introducing one would have contradicted the
product's existing documented decision architecture — flagged rather than
built.

### Bias-parameter values — a documented starting point, not a measured constant
`METAL_BIAS` (0.006) and `CRYPTO_BIAS` (0.015) are reasoned estimates
(gold and crypto both swing well beyond a forex major's typical %-range
over the same lookback), explicitly commented as such in `symbolProfiles.ts`
— not derived from `strategy_deployments`' `live_win_rate`/`calibrated_confidence`
data, because there isn't enough live history on those symbols yet to derive
them from evidence. Revisit once real data accumulates.

---

## Verification

- `npx tsc --noEmit` — clean after every change.
- Full targeted suites for each change (markets/ohlc/forex-price/execution/
  symbolProfiles) — 100% pass, run in isolation after each change.
- `npm run test:unit` (1050+ tests) run after Change 2, after Change 3, and
  at the end — **zero new failures** at any point. The ~7 failures present
  in every run (MCP-login ENOENT path bug, loading-skeleton coverage,
  SYSTEM.md canonical-identity pins, doctrine guard, reference-scenario
  coverage map) are pre-existing and unrelated to this work — confirmed via
  `git stash` + identical invocation immediately before starting and again
  at the end; a fresh baseline run at the very end actually showed *one
  more* failure (10) than this branch's final run (9), and the full-suite
  runner's own subtest/suite counts vary run-to-run under `git stash` alone
  with zero code changes (1064 vs 1059 tests, 424 vs 422 top-level entries)
  — confirming that variance is the test runner's own parallel-scheduling
  noise, not a signal to chase further.
- Adding the `OANDA_*` platform-config fields (Change 2) incidentally fixed
  one previously-failing test (`platformConfigCoverage.test.ts`'s "every
  platform-config key the code reads has a field in the panel") — confirmed
  present in the baseline failure set before this work started.

## Everything I could not verify — flagged, not guessed

- **Whether the configured OANDA account actually offers `BTCUSD` as a
  tradable/priceable instrument.** OANDA's crypto-CFD availability is
  jurisdiction/account-dependent; `toOandaInstrument("BTCUSD")` produces
  `BTC_USD` mechanically (matches the 6-letter symbol pattern), but I could
  not verify against a real OANDA account/token in this environment.
  `fetchOandaCandles`/`fetchOandaPricing` fail closed (empty result +
  warning, never fabricated data) if the instrument isn't actually served,
  so this degrades safely, but it should be checked against the real
  platform token before relying on live BTCUSD analysis.
- **OANDA's actual rate limit on concurrent streaming connections** — the
  shared single-connection design in `oandaStream.ts` was chosen partly
  because it minimizes connection count (one, regardless of user/symbol
  count), but I did not load-test it against OANDA's real streaming
  infrastructure.
- **The Docker/deploy-time step of actually setting `OANDA_API_TOKEN` /
  `OANDA_ACCOUNT_ID` / `OANDA_ENV`** on the running platform — this log
  covers the code; the operator still needs to provision real OANDA
  credentials via the admin panel (now that `platformConfig.ts` declares
  the fields) or environment for any of this to serve real data.
