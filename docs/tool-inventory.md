# AiChart MCP — tool inventory (Phase 0)

Ground-truth inventory of the 53 tools in `mcp/schemas/tools/*.json`, read directly from
`mcp/src/tools/schemas/*.ts` (contracts), `mcp/src/tools/*.ts` (handlers), `mcp/src/bridge/*.ts`
(response envelope + text fallback), and `mcp/src/ui/*.ts` (widget runtime). No implementation
changes in this pass — this document is the Phase 0 deliverable and a stop-for-review point.

Every number below was counted from the repo, not assumed from the brief. Two points where my
count differs from the brief's "measured" section are called out explicitly in §2, because the
difference changes what Phase 2 should scope.

---

## 1. How to read this

- **R/W** — read-only (`READ_ONLY` annotation) vs write (`DESTRUCTIVE`/`IDEMPOTENT_WRITE` or a
  custom annotation with `readOnlyHint:false`).
- **Bucket** — A consequential write · B rich read · C long-running · D plain read · E
  internal/meta, per the brief's definitions. Reasoning for every A/B call is in §4, since bucket
  alone doesn't say what the widget or dry-run needs to show.
- **UI today** — the `ui.widget` name from the tool's `_meta`, or `—` for text-only. A name in
  *italics* means the widget key maps to a **shared/reused** HTML template, not a bespoke one —
  see §2.3 for the reuse map.

---

## 2. Measured state — and where it differs from the brief

### 2.1 Tool count: 53 — confirmed
`ls mcp/schemas/tools/*.json | wc -l` → 53. Matches `TOOL_CATALOG` length (`CORE` 27 + `MARKET`
11 + `MT5` 9 + `CHARTS` 6). `npm run test:catalog` independently asserts `>= 50`.

### 2.2 Widgets: not "2" — 6 distinct templates behind 16 tool-facing names, 17 tools wired
`mcp/src/ui/widgets.ts`'s `WIDGETS` map has 16 keys. Six are genuinely distinct hand-authored
templates (`accountOverview`, `analysis`, `recommendationCard`, `openTradesCard`, `liveChart`,
and the shared `genericCard(title, subtitle)` factory); the rest are the same template registered
under a second name, or a `genericCard(...)` instance (a real, functioning key→value dumper —
not a stub, but not a bucket-specific design either: same layout for trade-readiness, lessons,
pending-approvals, pair-picker).

17 of the 53 tools carry `ui.widget` in their schema (see the table in §3 for which). The other
36 are text-only today. Of the 17:

| widget key | template | tools pointing at it |
|---|---|---|
| `account-overview` | `accountOverview` (bespoke) | `get_account_overview`, `get_live_account` |
| `portfolio` | `accountOverview` (reused) | `get_portfolio` |
| `analysis` | `analysis` (bespoke) | `get_market_snapshot`, `get_multi_timeframe_snapshot`, `run_market_analysis` |
| `levels-card` | `analysis` (reused) | `detect_levels` |
| `recommendation-card` | `recommendationCard` (bespoke) | `create_recommendation`, `scan_market` |
| `open-trades` | `openTradesCard` (bespoke) | `get_open_trades` |
| `live-chart` | `liveChart` (bespoke) | `get_chart_state`, `show_live_chart`, `draw_on_chart` |
| `trade-readiness` | `genericCard` | `get_trade_readiness` |
| `lessons-card` | `genericCard` | `get_trade_lessons` |
| `pending-approvals` | `genericCard` | `get_pending_approvals` |
| `pair-picker` | `genericCard` | `list_instruments` |

Two reuses are worth a second look before Phase 2 picks a first widget, not because they're
wrong, just because they're load-bearing on payload shape matching:

- `scan_market` → `recommendation-card`. `scan_market` compares **multiple symbols** and returns
  the best opportunity; `recommendationCard`'s template was built for **one** recommendation
  object. If `scan_market`'s payload is a list, the card either shows one candidate arbitrarily
  or breaks silently. Worth checking against a live `scan_market` response before Phase 2 reuses
  this pairing again.
- `detect_levels` → `levels-card` → `analysis` template. `detect_levels` returns
  support/resistance levels with strength scores; the `analysis` template renders
  price/trend/RSI/MACD/decision fields. None of those match `detect_levels`'s actual shape — this
  is very likely a silent-empty-card case in practice, not just a naming coincidence.

So: "2 widgets" undercounts distinct templates (it's 6) but overstates real per-bucket coverage —
of 53 tools, only 5 have a template that was actually built for their data shape
(`get_account_overview`, `get_portfolio`\*, `get_open_trades`, `create_recommendation`,
`get_market_snapshot`/`get_multi_timeframe_snapshot`/`run_market_analysis`). Everything else with
a widget key is either a straight reuse of one of those five, or a generic field-dumper.

\* `get_live_account` reuses `account-overview` too, but see §2.4 — its text fallback doesn't get
the benefit of that shape match.

### 2.3 Steering fields: confirmed 0 formal occurrences — but not a blank slate
`grep -rn "next_step\|recovery_tool\|adjustments\|assistant_response\|dry_run\|job_id" mcp/src`
returns nothing. Confirmed. But the tools already lean hard on **informal, per-response prose
steering** that Phase 1 has to coexist with, not duplicate:

- `resolve_agent_skills` returns `nextStep` (camelCase, a single string, e.g. *"Call
  load_agent_skill once per selected.name."*) — same intent as the brief's `next_step`, different
  shape (string vs `{tool, reason, params}`), different name (camelCase vs snake_case).
- Every chart-capture path (`capture_chart_snapshot`, `capture_multi_timeframe_snapshot`,
  `get_recommendation_chart`, `capture_mt5_chart`, `create_recommendation`'s auto-chart) already
  returns a `note` / `image_delivery` / `presentation` / `user_message` string engineered
  specifically to stop the model from hallucinating an image it never received, or to make it
  paste `display_markdown` verbatim. This is real, tested, production-hardened steering — it
  just predates the `next_step`/`recovery_tool` vocabulary and isn't structured.
- `create_recommendation`'s validation-failure path already returns a fixed, mapped recovery
  instruction ("Fix ONLY the fields above and call again...") — functionally a `recovery_tool`
  for exactly one failure mode, unstructured.

Phase 1 needs to decide: does `next_step` **replace** `resolve_agent_skills.nextStep`, sit next to
it, or does `resolve_agent_skills` get migrated onto the new field? Same question for the chart
tools' `note`/`image_delivery` guardrail text vs a formal `recovery_tool`. Flagged in §5.

### 2.4 A concrete, narrow bug found while reading, not a design question
`get_live_account` (`mt5.ts`) calls `bridgeWrap(bridge, () => bridge.get("/api/agent/live/account"))`
— `bridgeWrap` never passes `{structured: true}` to `formatBridgeResult`, so this tool's text
fallback is always raw `JSON.stringify`, even though its payload shape would satisfy
`isAccountOverview()` in `textFallback.ts` and could render through `formatAccountOverview()`
like `get_account_overview` and `get_portfolio` do. This is a one-line fix (pass
`{structured: true}` through `bridgeCall` instead of `bridgeWrap`), not a design call — flagging
here so it doesn't get lost, fixing it belongs in Phase 4 (or Phase 1, since it's on the way to
"every widget tool's text fallback conveys the result").

---

## 3. All 53 tools

### CORE (27)

| tool | R/W | bucket | UI today | notes |
|---|---|---|---|---|
| `get_account_overview` | R | B | `account-overview` | session-start call; aggregates 4 bridge calls |
| `get_trade_readiness` | R | B | *`trade-readiness`* (generic) | preflight go/no-go |
| `get_agent_capabilities` | R | E | — | first call of every session |
| `get_portfolio` | R | B | *`portfolio`* (= account-overview) | |
| `get_open_trades` | R | B | `open-trades` | |
| `get_trade_lessons` | R | B/D | *`lessons-card`* (generic) | structured but low-volume |
| `run_backtest` | W | C + B | — | research-service job, 120s bridge timeout already set |
| `get_strategy_performance` | R | B | — | 60s bridge timeout already set (advances pending backtests) |
| `create_recommendation` | W | B (adjacent to A — see §4) | `recommendation-card` | auto-attaches chart + card |
| `open_trade` | W | **A** | — | real order; no widget |
| `close_trade` | W | **A** | — | real close; no widget |
| `evaluate_trade` | R | B | — | live PnL + context for one open trade |
| `record_exit_decision` | W | D | — | audit-only, "does not auto-close" |
| `request_approval` | W | **A** | — | creates pending intent + Telegram buttons |
| `respond_approval` | W | **A** | — | approve MAY execute immediately |
| `get_pending_approvals` | R | B | *`pending-approvals`* (generic) | |
| `get_agent_settings` | R | E | — | fixed config |
| `get_agent_trade_mode` | R | D | — | 3 fields, but gates a real decision when `needs_choice` |
| `set_agent_trade_mode` | W | A-adjacent, no computed preview (see §4) | — | grants/revokes standing execution authority |
| `find_similar_cases` | R | B | — | historical evidence report |
| `send_telegram_menu` | W | D | — | notification only |
| `capture_chart_snapshot` | R/W(capture) | B (image-delivery, not table) | — | already well-served by `chartInlineContent` |
| `capture_multi_timeframe_snapshot` | R/W(capture) | B (image-delivery) | — | already well-served by `multiTimeframeContent` |
| `get_recommendation_chart` | R | B (image-delivery) | — | |
| `list_agent_skills` | R | E | — | metadata only |
| `resolve_agent_skills` | R | E | — | has informal `nextStep` already — see §2.3 |
| `load_agent_skill` | R | E | — | long text body, not tabular |

### MARKET (11)

| tool | R/W | bucket | UI today | notes |
|---|---|---|---|---|
| `get_market_snapshot` | R | B | `analysis` | symbol force-canonicalized — see §4.3 |
| `get_multi_timeframe_snapshot` | R | B | *`analysis`* (reused) | symbol force-canonicalized |
| `get_market_price` | R | D | — | scalar |
| `list_instruments` | R | B | *`pair-picker`* (generic) | |
| `get_chart_link` | R | D | — | one URL string |
| `get_market_context` | R | D | — | narrative news/sentiment prose |
| `scan_market` | R | B | *`recommendation-card`* (reused — shape mismatch risk, §2.2) | symbol force-canonicalized (via body, not `bridgeSymbol`, but downstream) |
| `get_ohlc` | R | D/E | — | raw candle series, mechanical input for the model, not for a human |
| `get_forex_indicators` | R | D | — | numeric evidence block |
| `detect_levels` | R | B | *`levels-card`* → `analysis` (shape mismatch — §2.2) | symbol NOT canonicalized (no `bridgeSymbol` call) — inconsistent with siblings |
| `detect_market_regime` | R | D | — | symbol force-canonicalized |

### MT5 (9)

| tool | R/W | bucket | UI today | notes |
|---|---|---|---|---|
| `connect_mt5` | W | A-adjacent, no computed preview | — | credentials + execution capability |
| `disconnect_mt5` | W | D | — | simple destructive, no preview needed |
| `get_mt5_status` | R | D | — | |
| `get_live_account` | R | B | *`account-overview`* (reused, but text fallback bug — §2.4) | |
| `get_account_symbols` | R | B | — (no widget — gap; `pair-picker`-shaped data with none) | full broker Market Watch, can be large |
| `capture_mt5_chart` | R/W(capture) | B (image-delivery) | — | |
| `modify_sl_tp` | W | **A** | — | real protective-level change |
| `cancel_mt5_order` | W | **A** | — | real cancel |
| `close_partial` | W | **A** | — | real partial close, realizes PnL |

### CHARTS (6)

| tool | R/W | bucket | UI today | notes |
|---|---|---|---|---|
| `list_chart_layouts` | R | D | — | small list |
| `get_chart_state` | R | B | `live-chart` | |
| `show_live_chart` | R | B | *`live-chart`* (reused) | |
| `draw_on_chart` | W | B | *`live-chart`* (reused) | visible, reversible (`clear_chart_drawings`) |
| `clear_chart_drawings` | W | D | — | simple destructive |
| `run_market_analysis` | W | **C** + B | *`analysis`* (reused) | up to 2 min; best candidate to pair Phase 2 report + Phase 3 job pattern |

---

## 4. What the user must see and decide — bucket A and B detail

### 4.1 Bucket A — the dry-run-eligible core (has a computed consequence to preview)

These 7 tools commit money, place/modify/cancel a real order, or immediately trigger one on
approval. Each has numbers a `dry_run: true` call can compute and show without committing:

- **`open_trade`** — see: computed position size (from verified equity × Risk per Trade ÷ stop
  distance), resulting exposure/margin, spread and estimated cost at entry, which constraint
  would bind if rejected (stale quote? session closed? spread ceiling? equity unreadable?).
  Decide: place it as specified, or adjust stop/entry first.
- **`close_trade`** — see: realized PnL at current price for the trade(s) that would close, which
  broker/account they're on. Decide: close now vs wait, close all vs one.
- **`modify_sl_tp`** — see: the position's current levels vs the requested ones, distance from
  current price to each (would the broker reject for stops-too-close?), which position (symbol,
  side, size) this ticket actually is.
- **`cancel_mt5_order`** — see: what the pending order actually is (symbol, side, price, size)
  before it's withdrawn — a ticket number alone is not enough for a human to confirm.
- **`close_partial`** — see: current position size, requested lots to shave off, resulting
  remaining size, realized PnL on the closed portion.
- **`request_approval`** — see: the full proposed trade exactly as it will be presented to the
  operator on Telegram (symbol/side/entry/stop/target/rationale) before it's sent.
- **`respond_approval`** — see: the pending intent being resolved (full trade detail) before
  approving — approving executes immediately, so this is the last preview surface before money
  moves.

### 4.2 Consequential but no computed preview — flagged, not yet bucketed

`connect_mt5`, `disconnect_mt5`, `set_agent_trade_mode` change state that matters (execution
capability, standing authorization) but there's no "sizing/exposure/cost" figure to compute
before committing — a dry-run in the bucket-A sense doesn't apply. `set_agent_trade_mode`
especially deserves a decision: switching to `auto` is the single biggest blast-radius action in
the whole catalog (it removes the per-trade confirmation step entirely), yet it's currently a
plain `DESTRUCTIVE`-annotated tool with no widget and no distinct confirmation surface beyond the
`confirmed_by_user` boolean the model is trusted to set honestly. Whether this needs its own
Pattern-A-style "you are about to authorize the agent to trade without asking again" card is a
real product question, not an inventory fact — raised for review, not decided here.

### 4.3 Bucket B — rich reads, and the symbol-canonicalization convention that needs a decision

`get_market_snapshot`, `get_multi_timeframe_snapshot`, `get_market_price`, `get_ohlc`, and
`detect_market_regime` all pass the caller's `symbol` through `toOandaForexSymbol()`
(`mcp/src/lib/forexSymbol.ts`) before calling the bridge — this **strips broker suffixes and
uppercases**, e.g. `XAUUSDm` → `XAUUSD`. `get_ohlc` additionally hardcodes `source: "oanda"`.
None of these five tools' *descriptions* say this happens. Per the brief's own convention list —
*"broker symbols are case-sensitive... uppercasing produces `Symbol XAUUSDM does not exist`"* —
this is exactly the failure mode the platform (web app) already fixed by preserving broker case;
these 5 MCP tools silently reintroduce platform-feed canonicalization on the way in. Two of the
market tools do NOT do this (`get_forex_indicators`, `detect_levels`, `get_market_context`,
`list_instruments` pass the symbol through untouched) — so the convention isn't even applied
consistently across the domain.

This is not obviously a bug: `get_ohlc`'s description already says "from OANDA," so forcing OANDA
canonical form there is arguably correct and should just be documented. But
`get_market_snapshot`/`get_market_price`/`detect_market_regime` don't claim to be OANDA-only, and
a caller asking for a linked broker's own book (to match the spread the platform actually trades
at) currently can't get one through these tools — the broker-suffixed symbol they pass is thrown
away before the bridge call. Flagged for a decision in Phase 4 (tool descriptions) at minimum, and
possibly Phase 1 (should `adjustments` report this coercion, the way it would report a clamped
`lots` value?).

`list_instruments`, `get_account_symbols`, `get_open_trades`, `find_similar_cases`,
`get_pending_approvals`, `get_trade_lessons`, `get_strategy_performance` — standard bucket-B
collections/reports; each needs its evidence-first, verdict-second treatment (Pattern C) or
row-first treatment (Pattern D) per the brief, no unusual findings.

---

## 5. Findings that need a decision before Phase 1/2 starts

Ranked by how much they change the plan, not by file order.

### 5.1 The widget runtime is currently, deliberately, and testedly read-only

`mcp/src/ui/runtime.ts`'s own header comment: *"Exposes a read-only data API: AIC.getData /
onData / callTool (data polling only)... **Cards render no action buttons.**"* This isn't just a
comment — `mcp/src/ui/__tests__/cardButtons.test.ts` actively asserts:

- no registered widget template contains a `<button>`, `role="button"`, or submit-type input,
- the shared runtime and an assembled page contain none either,
- **no widget still references a removed button element or calls `sendFollowUpMessage`** — i.e.
  buttons existed at some point and were deliberately pulled, and there's a regression guard
  against them coming back by accident.

This repo is a shallow clone (`git rev-parse --is-shallow-repository` → true, 210 commits, no
history before that), so I can't recover *why* buttons were removed from this checkout's git log.
But the test's own wording ("dead button click handlers," "button-only bridge call") reads as: a
button-driven interaction pattern was tried, hit a real problem in production, and was rolled
back with a regression test to keep it rolled back.

The brief's Phase 2 Pattern A explicitly asks for *"distinct confirm / modify / cancel buttons"*
on a decision card. That is precisely what this test forbids today. The plumbing underneath is
actually fine for it — `AIC.callTool(name, args)` already calls named tools through the real host
bridge with real auth, generically, not just for polling — so this isn't a transport rewrite. But
building the first actionable widget means either (a) getting an explicit answer on why buttons
were removed and whether that reason still applies, or (b) designing Pattern A's "confirm" step
some other way (e.g. a widget that calls `dry_run` and displays a message telling the operator to
approve in chat, rather than owning a button) until that's answered. **I'd stop here and ask
before Phase 2 writes a single button** — this is the one item on this list that can't be
half-corrected after the fact if the earlier removal reason turns out to still apply.

### 5.2 No `_meta.ui.csp` is declared anywhere — confirms the brief's "resolve this first"

`mcp/src/ui/index.ts`'s `uiMetaFor()` sets `openai/widgetCSP` (ChatGPT-specific, snake_case) but
never the actual MCP Apps `ui.csp` field (`connectDomains`/`resourceDomains`/`frameDomains`/
`baseUriDomains`, confirmed from `@modelcontextprotocol/ext-apps`'s generated schema). Given
widgets are already served from our own origin (`/mcp-ui/*` in `mcp/src/index.ts`) and chart
images already deliver as URLs from our origin (`/mcp-images/*`, deliberately — see the extensive
reasoning already in `imageDelivery.ts` about why base64-in-response was abandoned), the
origin-served choice looks already made in practice; it just isn't declared in `_meta.ui.csp`.
Recommend confirming that reading and adding the declaration in Phase 2, not inlining — inlining
would mean walking back `imageDelivery.ts`'s URL-based delivery, which has its own hard-won
reasoning (a 152 KB PNG rendering and a 158 KB one not, discovered live) that has nothing to do
with widgets and shouldn't be re-litigated to serve a different goal.

### 5.3 Two widget/tool pairings likely render an empty or wrong card today

From §2.2: `scan_market` → `recommendation-card` (shape mismatch: multi-symbol comparison vs
single-recommendation template) and `detect_levels` → `levels-card` → `analysis` (shape
mismatch: support/resistance data vs price/RSI/MACD template). Neither is a Phase 0 fix, but
Phase 2's "build one end to end" should NOT accidentally pick one of these as its target
believing the wiring already works — recommend checking a live response against the template
before committing to either as the first bucket-B build.

### 5.4 `next_step` / `recovery_tool` need to reconcile with existing informal steering, not duplicate it

From §2.3 — `resolve_agent_skills.nextStep`, the chart tools' `note`/`image_delivery`/
`user_message` fields, and `create_recommendation`'s validation-failure recovery text are all
doing real steering work today. Phase 1 should decide explicitly: migrate these onto the new
formal fields, or document why they stay as bespoke prose (e.g. the anti-hallucination image
notes arguably need to stay exactly as blunt and repetitive as they are — they were tuned against
an observed failure mode, and "recovery_tool" as a structured pointer might not carry the same
urgency as *"Do NOT describe or imply a chart image"* in the model's face).

---

## 6. Implicit conventions catalogue

Confirmed from source, for Phase 4's tool-description rewrite and for anyone calling these tools:

1. **Broker symbols are case-sensitive; two spellings, two pipes.** Canonical platform-feed keys
   are uppercase (`EURUSD`); a linked broker spells its own catalogue however it likes
   (`XAUUSDm`, `EURUSDm`). Applies across the whole platform (confirmed independently while
   removing the EA backend in the previous work on this repo — `normalizeSymbolCase` /
   `isBrokerSpelledSymbol` in `web/src/lib/markets/symbolCase.ts` is the canonical
   implementation). **Only two pipes remain: `oanda` and `metaapi`** — the EA bridge was removed
   entirely (see §5's shallow-clone caveat: that removal is this repo's most recent merged PR,
   `#121`). Any tool, schema, or doc text still mentioning `"ea"` as a source is residue, not a
   third option — confirmed **zero** such residue in `mcp/src` as of this inventory.
2. **`toOandaForexSymbol()` silently canonicalizes to OANDA form** in 5 of 11 market tools (§4.3)
   — inconsistent, undocumented in tool descriptions, flagged for Phase 4 at minimum.
3. **`resolveMarketDataSource` (web-side) never returns a pipe the account hasn't connected** —
   confirmed by reading the web repo's `marketDataSource.ts` in prior work on this codebase; a
   resolved `source` field can be trusted by anything downstream without re-checking.
4. **Spread differs materially per pipe** (48 pips OANDA vs 24 pips broker, same instrument, same
   moment, per the brief) — no MCP tool response currently labels which book a spread/cost figure
   came from except `run_market_analysis`'s `cost_evidence.source` enum
   (`observed_quote | live_cost_profile | session_profile | static_fallback | unavailable`) —
   this is the one place in the catalog that already does what the brief asks for generally.
   Worth using as the template for any other tool that surfaces a cost/spread number.
5. **`zLooseBoolean` exists because a real MCP host serialized `true` as the string `"true"`** —
   any new boolean-typed field in Phase 1/2 should use this shape, not bare `z.boolean()`, unless
   there's a specific reason not to.
6. **The bridge envelope is `{ ok, data }`, unwrapped automatically** by
   `unwrapBridgePayload()` in `bridge/client.ts` — tool handlers generally see the inner `data`
   directly, except live-forex snapshots which keep `{ ok, forex }` intact on purpose (comment in
   source). New tool handlers should not re-implement unwrapping.
7. **`structuredContent` is attached automatically** for any plain-object payload
   (`formatBridgeResult` in `bridge/client.ts`) — a tool never needs to opt in to get a card fed;
   it only needs to opt in (`{structured: true}`) to get the **readable text fallback** instead of
   raw JSON. This op-in is what's missing for `get_live_account` (§2.4) and is worth auditing
   across all 17 widget-linked tools before Phase 2, not just the one found here.
8. **Every long-running chart capture already treats a missing image as a hard stop, never a
   guess** — `chartTimeoutContent`, `brokenImageResult`, and the `multiTimeframeContent` "missing
   frame" path all explicitly instruct the model never to describe a chart it wasn't given bytes
   for. This is the existing precedent for the brief's "no synthetic/placeholder data ever" rule
   — Phase 2's live-panel pattern (staleness banners) should match this tone, not invent a new one.
9. **Version-bump discipline on widget URIs already exists** (`mcp/src/ui/uris.ts`'s
   `VERSIONED_WIDGET_PATHS`, `legacyWidgetUris()`) — a markup change requires bumping the `/vN`
   suffix, and old URIs keep serving current HTML for clients that cached the old one. New
   widgets must follow this, not invent a new versioning scheme.
10. **`get_agent_capabilities` is meant to be the first call of every session** (per its own
    description, and independently confirmed by the `lonora` MCP server instructions surfaced to
    this session: *"Session start: get_agent_capabilities → get_account_overview →
    get_agent_trade_mode → then await the operator's request"*) — any `next_step` chain design in
    Phase 1 should treat this as the fixed root of the graph, not something a chain can skip past.

---

## 7. Not investigated in this pass — explicitly out of scope for Phase 0

- Widget rendering in a real host (local example host / Claude connector) — Phase 2 acceptance
  item, not a Phase 0 one; no widget code was written or exercised here.
- `mcp/src/auth/` internals beyond confirming the header shape (`X-Aichart-User-Email` +
  `X-Aichart-User-Sig`, HMAC'd with the service token) that makes "a widget can't call
  `/api/agent/*` directly" true — full OAuth flow review wasn't needed for this inventory and
  wasn't done.
- `scripts/test-all-tools.mts` (`npm run test:tools`) — exists, not mentioned in the brief, not
  read in this pass. Worth a look before Phase 1 in case it already exercises tools live and
  would need updating alongside the schema changes.
- Whether `research-service` (backtest execution) already has its own job/polling model that
  Phase 3's `jobs_wait`/`show_jobs_by_ids` should reuse or wrap, rather than building a second
  one — `run_backtest` and `get_strategy_performance`'s existing 120s/60s bridge timeout
  overrides suggest there's already an async-ish pattern underneath worth reading before Phase 3
  design starts.

---

## Stopping here for review, per the brief.

No schema, handler, or widget file was modified in this pass.
