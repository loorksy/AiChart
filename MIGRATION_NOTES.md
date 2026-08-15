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

## Phase 3 (partial) — the entry/activation coherence fix

The plan marks this mandatory, and it is the one change in the whole migration
that fixes a bug users actually lost money's worth of signal to. Done in full;
the rest of Phase 3 (the G1–G7 gate chain) is **not** started.

**The incident.** A SELL was stored with entry 4348.27, SL 4360.78, TP1
4316.80, TP2 4297.97, and the rule "wick pierces 4348.27, then the M15 CLOSES
BELOW it". The rule fired, price ran through both targets, and the plan died
EXPIRED.

**The cause was not the tracker.** `recommendationStatus.ts` filled a sell on
`candle.high >= entry`. The instant the confirming candle closes below 4348.27,
price is below 4348.27 — and stays there all the way down. The nominal entry
became unreachable at the exact moment its own condition came true. Nothing
refused to store a plan whose words and whose numbers graded different things.

**The fix** is `src/lib/recommendations/entrySemantics.ts` — fill semantics as
part of the plan rather than an assumption:

| entry type | fills |
|---|---|
| `market` | at the creation quote |
| `limit_touch` | on a touch of `entry` — illegal with a close-based rule |
| `confirmation_close` | **at the confirming candle's close**; the nominal level is only a trigger |
| `retest_zone` | on a touch inside an explicit band |

`validateEntryCoherence` returns every problem (not the first) so one
corrective retry can repair a plan in a single pass. It refuses the incident's
exact combination, plus stop/target-on-wrong-side, a retest band reaching past
the stop, and RR measured from the real fill collapsing below the plan minimum.

`TrackedRecommendation` gains `effectiveEntry` — the price the plan is graded
on. Legacy `"limit"`/`"pending"` rows normalise to `limit_touch` at the fill
boundary, so stored history keeps grading exactly as before.

Prose is generated from structure (`describeEntry`), because the incident's
sentence promised a fill the stored semantics never intended, and prose written
independently of structure will always eventually drift from it.

13 regression tests in `__tests__/entryCoherence.test.ts` reproduce the
incident verbatim (wick through 4348.27 → M15 close below → run to 4316.80) and
assert it now grades TP1, plus the mirrored buy, the retest-zone case, and that
the original contradictory plan can no longer be constructed. Registered in CI
as `test:entry-coherence`.

## Phase 3 (continued) — the G1–G7 gate chain

The gate machinery is built and tested as pure modules. It is **not yet wired
into the orchestrator** — that rewiring is the remaining piece of Phase 3.

`src/lib/agent/gates/`:

- **`types.ts`** — gate ids, three verdict states, and `GATE_REQUIRED_TO_RUN`.
  The three states are the point: `pass`, `veto`, and `unavailable`. A gate
  that could not run is never a pass. Whether that blocks depends on what
  absence *means* — not knowing whether gold is minutes from an NFP print is
  itself the hazard (G1 required), whereas a missing liquidity map costs the
  analysis context (G2 optional).
- **`chain.ts`** — ordered, short-circuiting runner. Cheapest-and-most-decisive
  first: a plan a news blackout already forbids should cost one provider call,
  not seven. A gate that THROWS is recorded `unavailable`, never `pass` — a
  crash silently reading as consent is the failure this module exists to make
  impossible. `refusalSummaryAr` names the refusing gate, because "no setup
  right now" teaches nothing and "blocked 25 minutes around CPI" tells the
  operator what to wait for.
- **`newsWindow.ts`** (G1) — admin-configurable blackout, 30/15 default. Only
  `high` impact blocks; blocking on medium would silence the platform most of
  the week, which is its own dishonesty. Overlapping windows resolve to the
  last one to clear.
- **`strategyEvidence.ts`** (G5) — three outcomes, not two: calibrated (cite
  stats, confidence comes FROM them), uncalibrated (pass, labelled
  "غير مُعاير", quote **no** numbers), none (veto → WAIT). Matches rank by
  sample size before confidence, so a lucky 8-trade record can never outrank a
  214-trade one. `MIN_SAMPLE_SIZE = 100`.
- **`revalidation.ts`** (G7) — re-checks the plan against a fresh quote for the
  two ways a plan goes stale during analysis: the entry has run away
  (>0.3×ATR past it) or RR has degraded below the plan minimum. RR is measured
  from the live price, because that is the ratio the operator can actually get.

20 tests in `agent/__tests__/gates.test.ts`, registered as `test:gates`.

**Still to do in Phase 3:** wire the chain into `runUnifiedChartAgentInner` so
the specialists run AS gates rather than advisors, persist the verdict bundle
with the plan, and rewrite the doctrine/system prompt for gold-only identity
and first-class WAIT.

## Phase 3 (continued) — the chain is wired, and entry semantics survive storage

### The gates now decide

`runGateChain` runs in `runUnifiedChartAgentInner` immediately after the
synthesizer's decision and **before** the drawing plan and before storage. That
position is deliberate: a refused plan must leave nothing behind — no entry
lines on the chart, no tracker row, no card in the chat. Putting the chain
after drawings would have drawn a plan the platform then refused to stand
behind.

A refusal does not degrade the plan. `finalDecision` is rewritten to a WAIT
whose summary IS the refusal (`refusalSummaryAr`), whose `publicReasoningSummary`
is the checklist as far as it got, and whose recommendation is `{ action:
"wait" }`. Leaving the model's prose in place would keep telling the operator
to sell at a level that no longer has backing. `gateChain.verdicts` is
persisted with the plan under revision 1's `evidence.gateVerdicts`, so a
post-mortem can see what each gate knew — not merely that they all passed.

The specialists are **not** re-run. `gates/buildGates.ts` re-reads the results
the fleet already produced as gate ANSWERS instead of as evidence the
synthesizer weighs. Nothing here gives a second opinion on direction; a gate
only decides whether a plan may be issued at all.

### Two departures from the plan's letter, both about what absence MEANS

`GateDefinition.required` was added so a gate can narrow, for one run, whether
its `unavailable` verdict blocks. The verdict itself is always reported
honestly; only its consequence moves. The distinction it encodes:

- **A configured provider that stopped answering mid-analysis** is a live
  hazard. Something changed, the plan would walk into it blind, and it blocks.
- **A provider that was never deployed on this install** is a standing,
  admin-visible gap. Treating it as a live hazard would make the platform
  permanently silent while telling the operator something false about what just
  happened.

Applied to two gates:

- **G1** — `required: newsProviderConfigured()`. With no calendar provider the
  verdict is `unavailable` with the reason stated, costs confidence, and does
  not block. With a provider that timed out, it blocks.
- **G5** — `required: statisticalSupport == null`. A lookup that FAILED means
  we do not know the strategy's record, and that blocks. A lookup that
  succeeded and found nothing means the backtest pipeline that fills
  `strategy_deployments` is not deployed yet — that arrives in Phase 4. Until
  it does, a plan with no calibrated match is issued **without any percentage**
  and with the gap stated (−15 confidence), rather than the platform refusing
  every recommendation for lack of a table nothing writes to yet.

**The condition for flipping both to hard vetoes** is stated so it is not
forgotten: G5 blocks on `grade === "none"` once the Phase-4 nightly precompute
writes deployments carrying real win rates and sample sizes; G1 blocks on an
absent provider once the calendar is a deployment requirement rather than an
option.

No RR floor was introduced. `systemPrompt.ts` states that reward:risk is
descriptive evidence and not an acceptance threshold; adding a `minRr` to the
gate plan would have silently changed what the platform refuses, which is a
product decision and not a wiring one.

### The other half of the fatal entry bug

`entrySemantics.ts` was only half a fix. The fill rule was being collapsed to
`market | limit | pending` at **three** separate persistence points, so a plan
armed by a candle CLOSE was stored as a touch-filled limit and the tracker
never saw `confirmation_close` at all — the incident was still reachable
through the write path.

- `resolveEntryType()` derives the canonical type from the plan's STRUCTURE.
  Structure outranks the model's declaration on purpose: the incident's plan
  declared a pending limit while carrying a close-based rule, and believing the
  declaration is exactly how the contradiction got stored.
- `normalizeStoredEntryType()` coerces persisted strings on read, mapping the
  legacy `limit`/`pending` spellings (both meant "fills on a touch") onto
  `limit_touch` so every reader downstream shares one vocabulary.
- The type is now stored verbatim and read back canonically by the canonical
  store, the tracker, the chat card (`fromAgentResult`) and the session replay
  alike. `retestZone` and `effectiveEntry` ride the risk blob, which is the
  only place a fill band and a realised fill price can live.
- **G6** runs `validateEntryCoherence` at construction, so an incoherent plan is
  refused before it can be stored and then graded against a level its own
  condition made unreachable.

### `npm run test:ci` is green

It had not been green since Phase 1b, and the `&&` chaining meant each failure
hid every suite behind it. All of these predate this phase; each was fixed by
deleting or correcting what described deleted functionality, never by weakening
a live assertion:

- `integrationBoundaries` asserted `runExecutionGuardAgent` still lives in the
  orchestrator. It does not. The assertion is **inverted** to guard that no
  execution path grows back.
- `phase5Contracts` asserted seven phrases appear in `docs/TRADING_DNA_
  ARCHITECTURE.md`, deleted with the rest of `docs/`. Prime Directive 1 says
  docs are not the source of truth; a test that a markdown file contains seven
  phrases guarded nothing. The half constraining code survives.
- The trading-DNA fixture wrote ten historical plans as a TRIAL user and hit
  the three-recommendation cap at the creation choke point. The cap is correct;
  the fixture was pretending to be a trial. It now buys a subscription.
- Four suites resolved `../agent`, `../mcp` and `../docs` — paths from when the
  app lived in a `web/` subdirectory. They read **outside** the repository and
  died on ENOENT rather than asserting anything. Both shapes are now tried, the
  same ladder the runtime code already walks.
- Two synthesizer fixtures (`synthesizerCorrectiveRetry`, `doctrineScenarios`)
  described plans whose activation rule was **already satisfied** at the
  fixture's own current price — `close above 4000` with price at 4014. A
  validator added after those pins were written correctly refuses that, and its
  one rejection drowned every other assertion in both files. The levels were
  moved to genuine future triggers; the scenarios are unchanged.

### The reference scenario registry, narrowed to the product

Six §16 scenarios described the deleted execution layer — `advisory_mode`,
`auto_conditional`, `account_disconnected`, `disconnect_during_auto`,
`stale_revision_execution`, and `deep_research_revises` (deep analysis reports
`not_started` since the warehouse went). They are deleted from the registry,
from `CRITICAL_INTEGRATION_SCENARIOS`, and from the coverage map.

Nine more pointed at integration files deleted in Phase 1b. A coverage map
whose rows name files that do not exist is worse than no map, because it reads
as proof. `criticalReferenceScenarios.integration.test.ts` is rewritten against
the modules that own those behaviours now — the canonical store, the revision
mechanism, the lifecycle dedupe, and the gate chain — with eight tests against
a real SQLite file. Two rows were renamed with their concepts:
`condition_during_revision` no longer talks about stale *intents* (there are
none) but about the newer revision winning; `expired_or_invalidated` no longer
emits `execution_skipped` but asserts a terminal plan is never re-activated.

**Known remaining debt:** most scenario fixtures still name EURUSD. The
registry describes market situations rather than served instruments, so this
does not affect behaviour, but it should be narrowed to gold in Phase 8
alongside the gold-only guard test.

**Still to do in Phase 3:** SELF-VISION hardening (`visualEvidence.ts`,
`multiTimeframeCapture.ts`, `platformChartCapture.ts`) and the candle-reading
tool belt (`read_candles`, `switch_timeframe`, `capture_chart`, `read_zone`,
12-call budget), plus the doctrine/system-prompt rewrite for gold-only identity
and first-class WAIT.
