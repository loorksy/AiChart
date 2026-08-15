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

## Phase 3 (continued) — the doctrine, rewritten for the product that exists

### WAIT, narrowed rather than loosened

The constitution still described a Forex scalping assistant whose data came
from the operator's own MetaTrader account and which executed through MT5 after
explicit confirmation. A stale constitution is not merely out of date: it is
the text the model actually reads, so it keeps teaching behaviour the platform
can no longer perform.

The substantive change is WAIT. The old rule banned it outright, but what it
was really banning was EVASION — an absent opinion dressed as analysis, and an
operational fault dressed as a market decision. Both are still forbidden. The
gate chain introduces a third thing that is neither: the platform declining to
ISSUE a plan the model already decided, naming the check that refused and what
the operator is waiting for. So the line is drawn where it belongs:

> **The model may not wait. The gates may refuse.**

Concretely, and all three are tested:

- The synthesizer's Zod contract still offers only `buy | sell`.
- `POST /api/agent/recommendation` still rejects `action: "wait"` from an
  externally hosted model.
- `doctrineGuard` gains a test that the ONLY place a visible WAIT can be born
  is the orchestrator's `if (!gateChain.allowed)` branch. A wait produced
  anywhere else is the old failure wearing a new name — an unattributed refusal
  the operator cannot act on.

Two rules were promoted into the constitution because they are things the model
gets wrong when nobody tells it: the fill rule is part of the plan (a candle
CLOSE condition can never pair with a TOUCH entry at that level), and a
percentage may be quoted only from a calibrated record with an adequate sample.

`SYSTEM.md`, its `instructions-core` block, the `mcp-core` session block, the
onboarding bootstrap, and `systemPrompt.ts` are rewritten from one source. The
builtin fallback in `canonicalIdentity.ts` is regenerated from the file rather
than hand-copied, so the byte-parity test cannot drift.

### The MCP execution surface, deleted

Phase 1b removed the web execution layer and left the MCP catalogue advertising
it: **28 of 60 entries** were account, execution, and approval tools. None was
registered, so none could be called — and all of them were still described to
any model that connected.

That is not harmless. The catalogue is how a connected model learns what it can
do: a definition advertises a capability, the model plans around it, and the
call fails as "unknown tool" — or the model reports having done something.
`create_recommendation`'s own description instructed the model that "open_trade
or request_approval is the separate, explicit step that acts on it".

Deleted with the definitions: the approval and account CARDS (an approval card
renders Approve/Reject buttons wired to `respond_approval` through
`AIC.callTool` — a control that fails in the operator's hands), the
`assistantResponseFor` formatter map for the seven consequential tools, the
post-call recipes that re-read broker state to prove an order opened, and the
Arabic rules fallback telling the model to call `get_trade_readiness` before
executing.

Three guard tests were rewritten because a STRONGER invariant replaced each:
the ≥50-tool and ≥13-widget floors were targets meetable only by keeping dead
definitions; `cardButtons` collapses its approval-vs-execution line into "a
card shows, it never acts"; `contractParity` inverts to "nothing on the mcp
surface may be execution-classed".

`GET /api/agent/portfolio` and `GET /api/agent/live/account` are deleted too —
externally reachable bridge endpoints serving broker-account data from tables
this platform no longer writes, with no caller anywhere in the repo.

### Remaining Phase-1b debt, named so it is not lost

The acceptance grep (`metaapi|kill.?switch|executeIntent`) is at ~155 hits,
down from the MCP purge but not zero. What remains is web-side and falls in
three groups:

1. **Stale comments and admin/i18n strings** naming a provider that is gone.
   Text only; no code path.
2. **Defensive field readers** (`open_trades`, `positions`) in MCP widget
   runtime and text fallback — shape tolerance, not instructions.
3. **The trades/intents store surface** — `listTrades`, `listIntents`,
   `listOpenTrades`, `getMtAccountMeta`, `todayRealizedPnlUsd` still have live
   consumers on the Performance page, `tradeWatch.ts`, `dailySummary.ts` and
   `agent-status`. This is the real one: the Performance surface still renders
   broker trades and execution intents from tables nothing writes. It belongs
   to **Phase 5** (outcome tracking & Performance), where the surface is
   rebuilt around recommendation outcomes graded against OANDA candles, and
   pulling that thread here would have meant rewriting Phase 5 inside Phase 3.

## Phase 3 (continued) — SELF-VISION: the agent is told what it could not see

`visualEvidence.ts` claimed in its own header that "the model is told which
view it did not get". No code path did that. `collectVisualEvidence` computed
`missing` and the orchestrator threw it away; the model received two chart
images and nothing else.

That is not a cosmetic gap, because **absence is not self-describing**. A
payload carrying a 15m and a 1h chart cannot reveal whether a 4h was never
requested or was requested and failed — and only one of those permits the model
to say anything about the 4h. Nothing else in the prompt names the frames that
were asked for, so the model had no way to infer the difference, and a blind
run looked identical from the inside to a fully-covered one.

What changed:

- `VisualEvidenceResult` now carries `requested` — the denominator. Without it
  there was no way to compute coverage after the fact either.
- A **thrown** capture used to return `missing: []`, which reported total
  blindness as "nothing was asked for". It now marks every requested frame
  `capture_failed`. The one case that legitimately reports nothing is an
  unscoped run (`userId == null`): no layout to render means the eyes were
  never opened, and calling that a failure is a lie in the other direction.
- `visualCoverageNote()` states coverage in words the model can act on, and
  distinguishes partial sight ("do not describe price action on a view you were
  not shown") from blindness ("you are reading numbers alone").
- The note lives INSIDE `modelContext`, not beside it. That is load-bearing:
  `evidenceBundleImmutability` requires the persisted snapshot to be exactly
  what was serialized for the brain, and a first attempt that spliced the note
  into the user message alone broke it. Inside `modelContext`, what was read is
  what is persisted.
- The prompt rule changed from "if a timeframe is missing from the
  attachments…" (an inference the model cannot make) to "trust the stated
  coverage over the attachments".
- The operator hears it too. A run that asked for charts and got none used to
  say nothing at all; degraded and blind runs now emit an activity warning
  naming the frames.
- **G4 records what the brain could see.** A numbers-only plan is not refused —
  the platform has always degraded rather than going silent — but it costs 10
  confidence and the frames actually seen land in the persisted verdict bundle,
  which is the only place a post-mortem can learn whether the brain had eyes.

`visualTimeframesFor` also lost its 1m/30m/1w ladders, left over from the
multi-instrument product. Gold is analysed on 5m/15m/1h/4h with 1d as context
above the top frame, and an unknown interval now gets the intraday default
rather than a silently different ladder.

New suite `test:vision` (7 tests), registered in `test:ci`.

### The candle-reading tool belt — assessed, not built

The plan calls for `read_candles` / `switch_timeframe` / `capture_chart` /
`read_zone` behind a 12-call budget. Reading the code rather than the plan:

- `src/lib/agent/tools/` already contains a full framework — registry, policy,
  executor, telemetry, MCP adapter, and two read-only adapters — and **nothing
  in the repo constructs or calls it.** Adding four more definitions to an
  unused registry would produce exactly the dead code Prime Directive 6
  forbids.
- The capability itself already exists in a bounded form: the synthesizer's
  `requestExtraTimeframe` lets the brain ask for ONE frame it was not shown,
  captured through the same collector, with the first decision standing if the
  capture fails.

So the real work is not four tool definitions — it is turning the one-shot
synthesizer into a bounded browse loop and giving the extra-frame mechanism a
budget of 12 instead of 1. That is an architectural change to the decision
call, and doing it in the same phase that just rewired the gate chain through
that same call would have made both unreviewable. It is the first item of the
next phase of work rather than a line item quietly skipped here.

## Phase 3 (complete) — the browse loop: the agent reads the chart itself

The previous note said the tool belt was assessed and not built, because the
`src/lib/agent/tools/` framework has no callers and adding four definitions to
an unused registry would be dead code. That reasoning still holds — and it
pointed at where the capability actually belongs.

The synthesizer already had the shape: `requestExtraTimeframe`, one extra frame,
once. That is a good safety property and a poor way to read a market. The
question "what did price do when it came back to 4348?" has an answer in the
candles, and a brain that cannot ask it has to guess or stay vague.

So the one-shot round became a bounded loop with three verbs — the three
questions a chart reader actually asks:

- `view_timeframe` — show me that frame (image + its numbers).
- `read_candles` — the last N bars as numbers, when exact prices matter more
  than shape.
- `read_zone` — what price DID at a band: traded in, closed inside, closed
  through, rejected from.

`read_zone` is computed from the same candles `read_candles` returns, through
one dependency. Two providers could tell the model two different stories about
one market; one primitive cannot.

**Four bounds, because a loop the model steers is a loop the model can run
forever:** a 12-call budget, a 25s wall clock across the whole phase, a
per-verb whitelist (frames narrowed to 5m/15m/1h/4h/1d), and a repeat guard —
asking the same question twice spends budget to learn nothing, so it is refused
rather than served.

**The invariant that makes it safe to ship:** a complete decision exists before
the first round, and every failure path — refused request, failed capture,
unparseable re-read, exhausted budget, expired clock, missing dependency —
keeps the last good one. Browsing refines an answer; it never becomes a
dependency of having one. Eleven tests in `browseLoop.test.ts` hold exactly
that, one per failure path.

Refusals are NAMED (`unbrowsable_timeframe`, `already_attached`,
`repeat_request`, `budget_exhausted`, …) rather than silently coerced, and each
is counted with its verb. A loop that quietly rewrites what was asked teaches
the model nothing about its own limits.

The browse transcript rides the frozen evidence snapshot, so a replay sees the
same conversation the brain had rather than only its conclusion. The metric is
renamed `aichart_browse_rounds_total` with a `verb` label — it stopped being
about extra frames.

`extraFrameRound.test.ts` → `browseLoop.test.ts`, and the §16 coverage row for
`extra_timeframe_round` now names the budget test: what that scenario was always
about is that the round cannot run away, and the budget is what stops it rather
than a hardcoded "no third round".

**Phase 3 is complete.** Gates wired and enforcing, entry semantics surviving
persistence, doctrine rewritten with a first-class WAIT, SELF-VISION honest
about what it could not see, and the agent reading the chart with its own hands.

## Phase 4 (part 1) — the gold candle store, and why G5 was blind

### The finding: the backtest pipeline had no data source

Reading the code rather than the plan turned up something the plan did not
anticipate. The evidence factory is **intact**: `strategy_backtests` and
`strategy_deployments` exist with calibration, confidence intervals, and
selection-bias correction; `refreshStrategyDecay` / `refreshAllStrategyDecay`
already implement the decay monitoring Phase 4 asks for; the research service
and its `aichart-candle-warehouse-v1` dataset dialect, its validator and its
types all survived.

What did not survive was **the exporter**. `src/lib/research/warehouse.ts` was
deleted with the multi-symbol candle warehouse, and nothing else built that
envelope. So the pipeline could accept bars and never be given any: no backtest
could run, none could complete, `strategy_deployments` stayed empty forever —
and G5 could never grade a strategy because there was never a strategy record
to grade. The gate was not weakly configured; it was starved.

### `gold_candles` — one instrument, closed bars, idempotent writes

`src/lib/gold/candleStore.ts` + a table in both SQLite and Postgres schemas.

- **No symbol column.** This platform trades one instrument, and a symbol
  column is an invitation to store a second — the exact drift gold-only exists
  to prevent. The timeframe is the partition.
- **Closed bars only**, enforced at the write path. A forming candle's high and
  low are still moving; a backtest that read one would be trading a bar the
  market had not finished printing, and its win rate would be a measurement of
  the future.
- **Idempotent writes.** Backfill pages overlap by construction (the boundary
  bar appears in both), so a repeat write must be a no-op. `storeGoldCandles`
  returns how many rows were genuinely NEW, which is how the backfill loop
  knows it is still making progress rather than spinning on a range it has.
- **Sanity gate**: a high below its own low, a close outside the bar's range, a
  non-positive price. None of these fails a backtest — each produces a win
  rate, which is why they are refused at the door.

This is **not** a live-data path. Nothing in the request path reads it; the
market pipeline still goes straight to OANDA. Re-introducing a request-path
cache is what the earlier migration deliberately removed, and this is not that.

`syncGoldCandleStore` runs forward first (catch up to now — bounded and fast),
then backward (dig history — open-ended, capped per run). The other order would
leave the newest bars stale whenever the backfill ran long. Scheduled hourly in
`infra/aichart.cron`, which an existing guard test insisted on: a route that
exists in code and nowhere in the crontab is caught, and that guard earned its
keep here.

### The second blindness: live sample size is not the sample

Even with backtests running, `getStatisticalSupport` read `live_sample_size` —
the count of LIVE outcomes observed since deployment. That is the decay signal,
and it is **zero for every newly minted deployment**. A strategy validated on
400 backtested trades therefore reached G5 as a strategy with no record at all,
and `gradeStrategyEvidence` (which needs ≥100 trades and a win rate) could only
ever answer "uncalibrated".

The deployments row already points at the backtest that holds both numbers, so
the lookup now joins `strategy_backtests` and carries `backtestTrades` /
`backtestWinRate`. G5 reads those. Live outcomes stay what they are — the decay
signal, not the sample.

The win rate is never derived. Computing one from the calibrated-confidence
midpoint would manufacture exactly the unvalidated number the gate exists to
refuse.

### Still to do in Phase 4

- Wire `exportGoldWarehouseEnvelope` into the job submission path so
  `runForexBacktest` is actually called with a dataset (today only tests call
  it), and add the nightly precompute that walks the catalogue.
- The `backtest_results` cache and the vectorized loop — the "lightning" half.
  The store is the prerequisite for both and did not exist until now.
- Flip G5's `grade === "none"` to a hard veto once deployments carry real
  sample sizes. The condition is unchanged from the Phase-3 note; what changed
  is that reaching it is now possible.
- `market_cases` is frozen for the same reason the backtests were (the indexer
  needed bulk candles). The store unfreezes it; re-enabling the indexer is a
  follow-on, not part of this commit.

## Phase 4 (part 2) — submission, the result cache, and what "lightning" means

### The missing caller

`recordPendingStrategyBacktest` had **no caller anywhere**. `runForexBacktest`
was reachable only from its own tests. The job handler
`strategy_backtest_advance` could ADVANCE a backtest but nothing ever STARTED
one. Together with the deleted exporter, that is the full explanation for an
empty `strategy_deployments` on every install: three separate halves of one
pipeline, each waiting on a piece that was gone.

`strategies/backtestRunner.ts` is the connecting piece — catalogue entry →
strategy spec → gold bars from the store → research job → a pending
`strategy_backtests` row the existing `refreshStrategyBacktest` drives to
completion.

Two choices inside it are worth naming:

- **`intrabarPolicy: "worst_case"`.** When a bar touched both the stop and the
  target, assume the stop came first. A backtest that guessed the friendlier
  order reports an edge the tape never offered.
- **Costs from the observed session profile**, falling back to the static model
  the rest of the platform already uses — labelled, never invented. A backtest
  priced at a spread the market never charged is the most flattering lie a
  strategy factory can tell itself.
- **`MIN_BARS_FOR_BACKTEST = 5000`.** The evidence bar is 100 completed trades
  and a strategy does not trade every bar; submitting over a few hundred bars
  burns a research slot to produce a sample the gate would refuse anyway.

### `backtest_results` — the cache IS the lightning

What makes a backtest fast is not running it faster. It is not running it
again: a strategy's result over a fixed window of CLOSED bars cannot change.

The key is the whole claim — strategy, spec revision, timeframe, and exactly
which bars. Two parts of that are load-bearing and each has a test:

- **Spec revision.** A bump means entry, exit or risk geometry changed. Serving
  the old result would attribute one strategy's record to a different strategy.
- **Bar COUNT, not just the range.** A backfill that fills a hole INSIDE a
  window already covered leaves the range identical and the data different. A
  range-only key would hand back an answer from a run that never saw those bars.

Both failures are silent — the platform keeps quoting a win rate, just the
wrong one — which is why they are pinned rather than commented.

A **pending** row counts as a cache hit: the job is already in flight, and a
second submission for the same claim doubles the research spend to produce the
same answer. `refreshStrategyBacktest` settles the cache row when a run reaches
a terminal state, best-effort — the evidence row is the record, the cache is an
index over it, and a stale index costs one repeated submission rather than a
wrong number.

### The sweep

`/api/cron/strategy-backtests`, nightly at 02:40 UTC, **submission-bounded**
rather than catalogue-bounded: ~60 strategies across five timeframes is 300
research jobs, and firing them in one night would spend a month of budget on
the first run. The cache makes it resumable — each night picks up the claims the
last one did not reach and re-reads the ones it did.

It runs under ONE owner (`STRATEGY_PIPELINE_USER_ID`), because validated
strategy statistics are platform evidence rather than personal data — the
support lookup already falls back to the newest rows regardless of owner, so a
per-user sweep would pay the same bill once per operator for the same numbers.
A missing or non-existent owner is reported by name; a silent no-op would look
exactly like a sweep with nothing to do.

### Still open in Phase 4

- **Vectorized loops** live in the Python research service, not here. The
  TypeScript side submits and caches; whether the service's inner loop is a
  NumPy pass or a Python for-loop is a change inside `research-service/` and is
  measurable only once real jobs run against a filled store.
- **Flipping G5 to a hard veto** still waits on deployments carrying real
  sample sizes — which now requires only that the two crons run, rather than
  code that does not exist.
- `market_cases` re-indexing remains a follow-on.

## Phase 4 (part 3) — "lightning backtests", found by reading the engine

The plan asks for **vectorized loops**. Reading the code first turned up
something better: the backtest's cost was never the arithmetic. It was
quadratic, and in a place a profiler reports only as "the engine is slow".

`ConditionContext.index()` in `research-service/app/backtest/conditions.py`:

```python
def index(self, timeframe):
    bars = self.bars_by_timeframe.get(timeframe, [])
    duration = TIMEFRAME_MINUTES[timeframe] * 60
    close_times = [bar.timestamp.timestamp() + duration for bar in bars]  # O(n), every call
    return bisect.bisect_right(close_times, self.decision_time.timestamp()) - 1
```

An O(n) list built in order to run an O(log n) bisect over it. The engine
creates one `ConditionContext` per bar and every condition leaf resolves its own
index through `bars()`, so a 50,000-bar run with four leaves rebuilt a
50,000-element list **200,000 times** — ten billion operations to answer a
question whose inputs never change for the life of a run.

The bars for a (symbol, timeframe) are immutable during a run, so the close-time
array is memoised in the same shared cache the indicator series already use, and
the resolved index is memoised per context (one bar, many leaves, one answer).

**Measured**, same machine, four leaves, one strategy:

| bars | before | after |
|---|---|---|
| 4,000 | 8.98 s | 0.021 s |
| 8,000 | 37.43 s | 0.042 s |
| 50,000 | ~24 min (quadratic extrapolation) | 0.268 s |

The scaling confirms the diagnosis rather than just the speedup: before, 2× the
data cost 4.2× the time; after, 2× the data costs 2× the time and 6.25× costs
6.4×. Quadratic became linear.

At the 50,000-bar export ceiling that is the difference between a catalogue
sweep of ~60 strategies × 5 timeframes taking **days of CPU** and taking about a
minute. The nightly precompute and the result cache were built on the
assumption that a run is expensive; this is what actually made it expensive.

Vectorization was **not** adopted, and that is a decision rather than an
omission: the indicators are already single-pass (`sma` carries a running sum;
`ema`, `rsi` and Wilder smoothing are recursive by definition and cannot be
vectorized without changing their semantics or adding SciPy). Replacing them
with NumPy would add a dependency to buy a constant factor on the half of the
run that was never the problem.

Five tests in `test_condition_context_cost.py` pin the fix where it matters —
identical answers to the naive computation, one array per (symbol, timeframe)
per run, one index per context, and separate timeframes keeping separate
arrays. The whole Python suite passes (56 tests).

**Note on running the Python suite here:** it needs `pytest-asyncio`, without
which 17 async tests report as failures that look like engine faults. They are
not; with the plugin installed the suite is green. Worth knowing before anyone
reads a red run as a regression.

## Phase 5 (part 1) — the surfaces that 404'd in the operator's hands

The Performance page shipped a whole section — "open trades" and "pending
approvals" — whose four controls posted to `/api/trades`,
`/api/trades/:id/close` and `/api/trades/intents`. **All four routes had been
deleted with the execution layer.** The section rendered, the buttons looked
live, and every click answered 404. Beside it, a nav pill linked to `/journal`,
a page that does not exist either.

Nothing caught any of it, and nothing could have: TypeScript does not
type-check a URL string, the build does not resolve one, and no test asserted
that a component's target was reachable. A deletion in one place silently broke
a surface in another — the failure mode a migration produces most.

### The guard first

`uiTargetsExist.test.ts` reads the component tree, collects every literal
internal `href` and every `/api/...` passed to `fetch`, and requires a matching
route file. It found **three more dead API calls and eighteen dead links**
beyond the ones already known:

- `Mt5PresencePing` pinged `/api/mt5/heartbeat` on a timer from the console
  shell — a deleted route, called on every page, forever.
- `SmartChartWorkspace` polled `/api/console/trades-active` every 30 seconds to
  badge an open-trades count, and rendered the failure as zero. Its button set
  `tradesOpen`, which nothing read: the drawer it opened is gone.
- `PendingIntentQuickActions` approved and rejected intents against
  `/api/trades/intents/:id`.
- Links to `/console/trades`, `/console/connect`, `/console/account`, `/plan`,
  `/reports`, `/chart`, `/complete-profile`, `/p/privacy-policy` — none of
  which exist.

Two parser details are load-bearing, both learned from false positives the
first version produced. Template literals are scanned by hand rather than by
regex, because a `${...}` hole can contain quotes — `/api/auth/${isLogin ?
"login" : "register"}` ends a character-class match mid-URL and reports a route
nobody wrote. And a hole matches ANY segment rather than only a dynamic one,
because that same expression interpolates a choice between two literal routes.
Nothing real is lost: a call to a prefix that does not exist still fails, which
is every case this guard was written for.

### Then the deletions

Seven components deleted, four of which had **zero importers** already
(`DashboardClient`, `UserAccountClient`, `McpUrlGuide`,
`RecommendationsHistoryClient`, `BridgeOverviewClient`) — dead trees whose
broken links were invisible precisely because nothing rendered them.
`TradesClient`, `WaitingRoom`, `PendingIntentQuickActions` and
`Mt5PresencePing` were reachable and are gone with the flows they served.

The notification panel's "N صفقة بانتظار الموافقة" block went with them, and
`pendingIntents` was pulled out of `/api/me` and `useMe` — a number computed on
every session load to render a row that could not exist.

Surviving links were repointed rather than deleted where a real destination
exists: `/p/privacy-policy` → `/privacy`, `/console/account` →
`/console/settings`, `/console/connect` → `/console/settings/alerts`.

### What the Performance surface is now

Recommendations → Statistics → Backtests. Three sections, three routes that
exist, no controls that fail. The plans, how they turned out, and the validated
strategies behind them — which is the whole performance story a
recommendations platform has.

**Still to do in Phase 5:** the outcome tracker itself — grading every
recommendation to a terminal state against OANDA candles, with the spread-drift
check wired to a live quote, and the stale tracker header comment corrected.
This commit removed what was lying; the next one makes what remains complete.

## Phase 5 (part 2) — the tracker: a dead trigger and three lying comments

### Spread drift could not fire

`recommendationTracker.ts` held this:

```ts
// No live-quote source for spread drift since the EA bridge was removed —
// metaapi/mt5local never fed one either, so this was already always null.
const currentSpread: number | null = null;
```

The rule was written, the threshold was set (2× the costed spread), the
detector was tested at its own boundary — and it was fed a hardcoded `null`.
A plan costed at 20 pips and now trading at 60 re-evaluated for every reason
**except the one that had actually invalidated it**.

A quote source exists now: the same platform-level OANDA book G7 revalidates
against. `liveSpreadPips()` reads it, converts to **pips**, and hands the rule
a real number.

That conversion is the load-bearing half. `plannedFor` is pips; a raw `ask −
bid` is price; on gold those differ by 100. Feeding the rule the raw difference
would have reported every plan's spread as having NARROWED 33×, and the trigger
would have stayed silent for a different reason. The file's own comment records
this exact units bug being caught once before on the planned side — so the test
pins the conversion, not just the threshold.

Absence stays absence: no quote means the check did not run this pass, never
that the spread is fine. The lookup is best-effort because the sweep walks
every active plan and must not drop one because the book went quiet.

### Three comments that described a platform that no longer exists

Prime Directive 1 says file headers can be stale. These three were:

- `recommendationTracker.ts`: "pulls candles live from the user's linked
  MetaTrader account". It pulls from OANDA at platform level, and there is no
  linked account on this path.
- `/api/cron/recommendation-sweep`: "against fresh warehouse candles". The
  warehouse was deleted.
- `recommendationStatus.ts`: "A market entry starts triggered; a limit/pending
  entry triggers on touch" — written before fill semantics existed, and now
  describing exactly the assumption that caused the incident. Replaced with the
  four real fill rules and the note that everything downstream reads
  `effectiveEntry`, never the nominal level.

The crontab comment repeating the MetaTrader claim went with them.

**Still to do in Phase 5:** nothing structural. The tracker grades every
non-terminal plan against closed OANDA candles on a 5-minute sweep, resolves
same-candle ambiguity SL-first, distinguishes a missed opportunity from a plain
expiry, and now re-evaluates on genuine cost drift.

## Phase 6 — Telegram: from a notification pipe to a surface

The bot was **outbound-only**, and deliberately so: the setup route's whole job
was to call `deleteWebhook()`, with a message explaining that "trading is via
Claude MCP and the platform only sends notifications". So an operator could
receive a recommendation on their phone and had **nowhere to ask for one**.

The link flow was half-built in the same shape as everything else this
migration has turned up: the platform minted a `t.me/bot?start=CODE` deep link,
the operator tapped it, Telegram delivered `/start CODE` — and nothing
listened. **`consumeLinkCode` had no caller anywhere in the repo.**

### One brain, two transports

`telegram/webhookAgent.ts` runs the SAME `runUnifiedChartAgent` the chat stream
runs, through the same gate chain, labelled `surface: "platform"` because it IS
the platform's brain. The transport changed; the decision path did not. A
separate decision path here is exactly how two surfaces start giving different
answers to one question, and the parity test asserts the shared entry point
rather than trusting the comment.

What Telegram does NOT get is a second set of capabilities. Cards carry a link
back to the platform and nothing that acts — there are no execution buttons
because there is nothing to execute, `allowed_updates` is `["message"]` alone,
and a test asserts `callback_data` appears nowhere on this surface.

### Everything else is shaped by Telegram's retry contract

Telegram redelivers an update until it gets a 200, on **its** schedule. A
40-second analysis is long enough to be retried mid-flight, and the second run
would store a second recommendation for one question. So:

- **Dedupe happens before work starts**, in memory, on a 10-minute window that
  sweeps itself. The window that matters is minutes; a restart clears a queue
  Telegram has also given up on; a database round-trip per update would buy
  durability nobody needs.
- **Every path answers 200** — a malformed body, an unsupported update type, a
  failed analysis. A 500 surfaces the error to nobody and asks Telegram to send
  the same broken update again.
- **The one exception is the secret check.** A caller who fails it is not
  Telegram, so there is no retry loop to avoid. That check is not optional
  hardening: the webhook URL is guessable and the handler behind it runs the
  whole decision engine, so without `TELEGRAM_WEBHOOK_SECRET` anyone who found
  the path could spend the platform's model budget. The route refuses to serve
  at all when it is unset, and `/api/telegram/setup` refuses to REGISTER a
  webhook without one.

An unlinked chat is never analysed — it is told how to link. The test pins the
ordering of those two branches, because "answer first, check later" is a
one-line mistake that would make the engine free to anyone who found the bot.

### Execution-era configuration, removed while here

`getMaxSpreadPips()` existed to pre-flight an order — reject `open_trade` when
the spread was too wide. Nothing places orders, and its only importer
re-exported it to nobody. Spread still matters to a plan, and that reasoning
lives where it belongs: in the cost evidence the decision weighs and the drift
trigger the tracker watches.

`METAAPI_TOKEN` was still an admin-panel field, still in `.env.example` labelled
"required for execution", and still pinned BY NAME in
`platformConfigCoverage.test.ts` as a key the operator must be able to set. That
test exists to stop a credential becoming unreachable; it had inverted into
requiring a field for a credential nothing reads — an invitation to enter a
token that would never be used. It now pins `OANDA_API_TOKEN`, which is the key
that actually strands the platform when it is missing.

## Phase 7 — assessed, and a dead layer deleted instead

The plan asks for 22 Agent Artifact card types, each with a zod schema, a
renderer, a Telegram fallback and a snapshot test. Reading the code first
changed what that means.

**There is no card-rendering framework to add 22 types to.** What exists is:

- `cardComposer.ts` (263 lines) — a shape-driven composer producing a
  `ui_schema` layout;
- `cardPolicy.ts` (215 lines) — contextual selection and dedupe over that
  layout;
- `uiSchema.ts` (30 lines) — an extractor pulling such a block out of a model
  reply.

A complete card pipeline, **with zero consumers**. Nothing imports
`composeCardSchema`, nothing imports the policy, nothing renders a `ui_schema`,
and the components it emits — `positions_table`, `account_overview`,
`pair_browser` — belong to the execution layer and the multi-instrument product
that no longer exist.

The card that actually renders is `RecommendationTrackerCard`, one bespoke
component, plus the ~12 Telegram card builders in `telegramCards.ts`.

Adding 22 schemas to a pipeline nothing renders would have been the single
largest dead-code addition in this migration — precisely the pattern every
earlier phase has been REMOVING (structure present, wiring absent), and a direct
violation of "prefer deleting code over keeping dead code". So the dead layer is
deleted (596 lines + its test), and Phase 7 is recorded as **assessed, not
built**, with the honest sequencing: a renderer would have to exist first, and
whether this product wants 22 card types at all is a question for a UI with
three surfaces by design.

## Phase 8 — the guards

The plan's acceptance criterion for Phase 1b was a grep for
`metaapi|kill.?switch|executeIntent` returning zero. It returns ~135, and the
distribution is the point:

- **~130 are comments** recording why something works the way it does.
- **`executeIntent`** appears only inside comments and inside the guard tests
  that ban it.
- **`kill.?switch`** hits are an LLM-gateway admin toggle and a dropped Postgres
  column — different features that share a word.
- **Two were live code**, now fixed.

A word-grep is the wrong acceptance test: it cannot tell a comment about
history from a code path that can move money, and a check that flags the former
gets silenced within a week. So Phase 8 replaces it with guards that assert the
property itself.

### `noExecutionGuard.test.ts`

Asserts the four things that would have to be true for an order to reach a
broker: no HTTP client posts to a broker order path (matched on the URL the
BROKER owns, not a function name a refactor renames); no execution tool is
registered **or catalogued** in MCP, and no surviving tool's description names
one (that is how `create_recommendation` came to instruct models to call
`open_trade`); no API route exists to accept an execution request; and the
decision contract cannot express a size, because a lot size is the last thing
between a plan and an order.

**Each arm was verified to fail on a real violation** — a probe route, a broker
URL, a catalogue entry, a `calculateLots` helper — before being kept. A guard
that passes because it checks nothing is worse than no guard.

### `goldOnlyGuard.test.ts`

Pins the SHAPE, where `goldOnly.test.ts` pins the contract, because gold-only
erodes by ADDITION and no existing test notices a new symbol. It found five
real leaks:

- the **landing page advertised "حلّل EURUSD" / "Analyze EURUSD"** — marketing
  a market the platform does not cover;
- `OpportunityScanCard` offered a `"EURUSD أو XAUUSD"` placeholder;
- `chart-background` and `v0-ai-chat` defaulted to EURUSD;
- `store.ts` re-typed `"XAUUSD"` as a chart-layout default instead of importing
  the one definition.

Three of those components had zero importers and are deleted; the landing copy
and the store default are fixed. The guard also holds that `gold_candles` has no
symbol column, that the analysed and stored frames agree, that the OANDA
spelling stays at the provider boundary, and that the exporter refuses a
non-gold symbol rather than coercing it.

Both suites plus `uiTargetsExist` run as `test:guards` in `test:ci`.

## The case memory started growing again

`caseIndexer.ts` said, in a header that was true when it was written, that
there was no indexer in this repo: a case needs tens of thousands of candles
walked in sliding windows, and the bulk candle source that served it had been
deleted. So `market_cases` stopped growing, and `find_similar_cases` had been
answering out of whatever it happened to already hold — a memory that quietly
stopped learning while continuing to sound authoritative.

The gold candle store rebuilt in Phase 3 is that missing source.
`goldCaseIndexer.ts` is the walker: it strides four bars at a time across each
stored timeframe, fingerprints the moment, resolves what followed, and writes
BOTH directions at every moment. Indexing one side would build a memory that
can only ever confirm.

It resumes from `MAX(case_time)` rather than re-indexing, is capped so a first
pass over years of history finishes, and runs nightly from
`/api/cron/case-memory` (`20 3 * * *`), which now indexes before it reports
coverage.

### The invariant, and a test that failed to check it

A case claims what the market looked like at a moment AND what happened next.
Those halves come from disjoint candle ranges — features from candles at or
before `caseTime`, outcome from candles strictly after — and mixing them by one
bar turns the memory into a record of the future. Nothing about that failure is
visible in production: the rows look right, the win rates look good, and the
platform quotes a memory that cheated.

The first version of the test asserted only that longs opened late into a
rise-then-collapse series lost money. **A deliberate 30-bar lookahead leak
passed it** — the collapse punished late longs whether or not the features had
peeked. A test weaker than its own description is worse than none, so it was
replaced with a direct one: the stored `trend`, `range_zone` and `regime` are
compared against `fingerprintAt` recomputed over the pre-case window ALONE,
across at least ten cases. The same leak was re-injected against the new
version and it failed, which is the only reason the arm was kept.

Excursions are stored ATR-normalised, matching what `caseQuery` reads back out
of `max_favourable`; a price-unit number there would be ~100x larger on gold
and silently incomparable with every row already indexed.
