## Round 3 — retired LLM gateways, silent notifications, surfaces with their own models

**OpenRouter and TokenRouter are gone** (commit `0ab12eb` and follow-ups). The
provider union is `openai | anthropic`, the curated catalog carries only those
two, and the admin routes/icons for the gateways were deleted. Operators
upgrading a live database get an automatic, idempotent purge on the first
config refresh (`purgeRetiredGatewayConfig` in `src/lib/platformConfig.ts`):
the eight retired `platform_config` rows (`OPENROUTER_*`, `TOKENROUTER_*`) are
deleted, an `AI_PROVIDER` still set to a retired gateway is rewritten to
`openai`, stored user model preferences shaped `openrouter/*` / `tokenrouter/*`
are nulled (those users fall back to the platform default), and the gateways'
`model_prices` rows are removed. Historical `usage_events` rows keep their
original provider string — they are spend history, not configuration.

**The platform default model is Claude Sonnet 4.6** (`claude-sonnet-4-6`,
multimodal). The composer's model picker no longer offers an abstract
"platform default" row: the default model appears under its own name,
pre-checked, and the user changes it by picking another.

**All notification channels were removed** — web push (VAPID/`web-push`),
the in-app notification center, and unsolicited Telegram sends (lifecycle
alerts, the weekly report, scan announcements). The lifecycle pipeline
survives as a pure ledger: dedupe keys are still claimed in `alert_dedupe`,
so sweeps and re-evaluation admission behave exactly as before — nothing is
delivered. `alert_log` and `push_subscriptions` tables stay in place as
history; no code writes to them anymore.

**Telegram is its own agent surface**: `surface: "telegram"` in the
orchestrator and parity log, a per-user `telegram_model_ref` column on
`trading_settings` (auto-added on both SQLite and Postgres), a `/model`
command with an inline keyboard, and metered LLM spend. Same brain, same
tools — a separate surface with its own model pick.

**MetaAPI hardening**: new accounts are created as `cloud-g2` (cloud-g1 is
retired upstream), a rejected platform token reports as a 503 configuration
error instead of "wrong broker password", refresh probes are best-effort and
can no longer wipe the stored login or fail the request on a timeout, and a
404 from MetaAPI on refresh unlinks the stale local row.


## Round 2, Phase A — the orphans, and the 404s hiding behind them

The owner asked for "orphan UI sections" to be deleted. The inventory found
something worse first: **five navigation targets that do not exist**, invisible
to `uiTargetsExist` because that guard read only `href=` literals — and a
`redirect()` is not an anchor tag.

- `/awaiting-approval`: the redirect target of five layouts and the auth
  flows. A blocked user bounced from every entry point into a 404. The page
  now exists, rendering `accessBlockMessage` for the user's actual state.
- `/complete-profile`: same story, for Telegram-login users without MCP
  credentials. The page now exists and **hosts the credential form itself** —
  it cannot link to settings, because every console layout bounces this user
  straight back here; a "finish your profile in settings" button is a redirect
  loop. This also explains the "orphan" `/api/me/credentials` route: its whole
  guard is `needsMcpCredentials`, and its consumer was the deleted page.
- The profile menu's `/console/account` push → `openSettings("profile")`,
  the overlay contract the shell already established.
- Settings `TAB_MAP` integrations → `/console/settings` (was `/console/connect`).
- `/console/platform` bounced non-admins to `/console` — not a page, a
  next.config redirect chain — now `/chat` directly.

`uiTargetsExist` now scans `redirect(...)`, `permanentRedirect(...)`,
`.push(...)`, `.replace(...)`, `.prefetch(...)` — probed by reintroducing one
of each violation class and watching it fail. It found the sixth target
(`/console`) within seconds of being strengthened.

Deleted (verified zero importers): 23 components (AgentRunStages,
AgentThinkingTicker, AgentChatSidebar, AdminOverview, ChartChrome,
ChartLivePriceBadge, four ui/shell pieces, four ui pieces, seven squareui
pieces, two foundation pieces), CardGridSkeleton, `/register`, the
`/api/command/*`, `/api/admin/pages*`, `/api/support/tickets*` routes,
`chatShareHref`, the dead Execute-button branch in ChartTradeOverlay, and
`ADMIN_NAV` — a parallel admin nav computed on every render and consumed by
nothing while the real rail read `adminNavTree`. Three skeletons that looked
orphaned were only *export*-orphaned (used inside their own module) and were
demoted to private instead of deleted.

### The landing stopped selling a deleted product (owner-approved)

The landing and pricing copy still sold "MetaTrader execution with your
approval" — hero, benefits, step 3 of how-it-works, trust list, two
testimonials, the FAQ, the footer, and the pricing card's feature list
(`mt5Link`, `liveExecution` — both `true` in `billing/tiers.ts`). Features
nobody could use, on the page that creates accounts.

Rewritten in both languages to the real product: gold recommendations,
mandatory named checks that may refuse, every recommendation tracked to its
outcome, Telegram as a full agent, OANDA as the data source, and — stated
plainly — the platform never executes. The tier features are renamed to real
deliverables (`telegramBot`, `trackedRecommendations`). A new landing-test arm
bans the AFFIRMATIVE execution claims by phrase (denials stay legal — the FAQ
still names MetaTrader, to say it is not needed) and pins that `mt5Link` /
`liveExecution` never return to the tier table.

Drive-by: `seo.test.ts` had three type errors on main (the team's SEO round);
`tsc --noEmit` was red at baseline. Fixed so the per-step gate means something.

## Round 2, Phase B — a closed market is a scenario, not a refusal

The owner's report: on weekends the agent apologizes ("السوق مغلق... عد عند
فتح السوق") instead of giving the expected scenario for the open with a
recommendation. The exploration found the promise ALREADY in the product —
the Telegram greeting says "والتوصية تنتظر الافتتاح" — with no code path
behind it: one early return in the orchestrator refused every weekend
request before a byte of data or model spend.

Deleting the early return was the easy fifth of the work. Four other things
each independently killed a weekend plan:

1. **No next-open existed.** `MarketSessionStatus.nextOpenTime` was declared
   and never assigned anywhere. `nextMarketOpenAt` now walks forward UTC-hour
   boundaries through the same memoized NY wall clock the open/closed answer
   uses — Sunday's open is 22:00 UTC in summer and 23:00 UTC in winter, and
   both regimes are pinned by tests as the REASON it walks instead of adding
   offsets.
2. **Wall-clock validity was born expired.** A Friday 15m plan expired in
   ≤3h against a Monday open ~49h away, and the Saturday cron sweep actively
   marked pending plans expired with zero new candles. The fix anchors the
   clock ONCE, at creation (`recommendationClockAnchor`): on a closed market
   validity counts from the next open. The sweeps are deliberately untouched
   — a plan whose clock genuinely ran out Friday still dies on Saturday's
   tick, and a test pins that division of labour from both sides.
3. **G7 would block or lie.** OANDA answers weekend pricing with Friday's
   number and `tradeable: false` — a flag that was parsed and never read, so
   the stale quote could masquerade as live. `usableQuote` now refuses a
   halted instrument; in scenario mode G7 revalidates geometry against the
   last CLOSE — the only honest price of a paused tape, and the same number
   every other part of the scenario was built from.
4. **The model's trigger deadlines died before Monday.** Activation-rule
   leaves carry `expiresAt` relative to the model's now — a Saturday. Without
   shifting, a "expires in 6 hours" trigger is dead ~40 hours before the
   first candle that could satisfy it, and the plan sits awaiting_activation
   until it expires unmet. `shiftActivationRuleExpiries` moves every stated
   deadline (composites included) forward by the closed gap.

The mode itself: `resolveClosedMarketScenario` — pure and clock-injectable,
with the three standing exemptions (reevaluation / replay / educational) as
ARGUMENTS a test calls rather than source strings the old test regexed for.
When active, the run proceeds on Friday's candles; the plan is FORCED
conditional/awaiting_activation before the gates read it (the synthesizer is
also told, via a prompt block — but prose from a prompt is a hope, and the
guarantee is the post-normalization force); the summary opens with a
deterministic Arabic notice naming the next open in Riyadh time; and the
result carries `marketClosedScenario` so both surfaces render a new
`scenario_notice` card — FIRST in the reading order, because an operator who
reads the plan before learning the market is closed has been misled for
exactly that long. The closed-union card contract did its job: adding the
kind refused to compile until both renderers handled it.

Also deleted, because nothing can produce them any more: the `market_closed`
failure code (taxonomy strings in both languages), the bridge error enum
entry, the MCP steering recovery entry, and the analyze route's 409 twin.
The MCP analyze path now bills a weekend scenario like any other analysis —
it IS an analysis.

Deliberate non-changes: holidays stay unmodelled (the calendar's own stated
stance — a missed holiday reads as a small gap the ratio policy tolerates,
and takes the stale-data path, not this one); plans created shortly BEFORE
Friday's close keep today's wall-clock expiry.

## Round 2, Phase C — the Telegram turn became professional

The owner screenshotted a competitor bot: a status bubble that updates while
the agent works, a collapsed "Called 2 Tools" block with per-tool checkmarks,
the answer quoting the question. The team had already built the skeleton
(`TelegramLiveTurn`, the turn classifier, opaque inline options); what was
missing was every wire between the engine and the phone.

**Live progress.** The engine has narrated itself all along — `emitStage`
fires for market data, structure, liquidity, news, the decision — and the
Telegram surface passed a no-op, so the bubble changed twice and froze for
the tens of seconds the run actually takes. `TelegramProgressReporter` is the
missing wire: an Arabic checklist that ticks forward in the bubble, throttled
to one edit per 2.5s with a trailing flush (Telegram tolerates ~1 edit/sec),
typing kept alive every 4s (the native indicator dies in ~5), every send
best-effort, and `finish()` called BEFORE finalize so a trailing progress
edit can never overwrite the answer.

**The tools block.** The final answer appends `<blockquote expandable>` —
Telegram's native collapse — listing the checks that actually ran, from the
reporter's own snapshot, never a hand-maintained list. `KNOWN_STAGES` moved
from the web trace component into `stageEvents.ts` so both surfaces read one
list, labelled through the same `agent.stage.*` i18n entries (coverage now
asserted per stage).

**The right theatre for a conversation.** "من انت" got the wake/think
ceremony, a gold chartContext, an EXTRA suggestions-LLM round-trip, and four
trading chips on an identity answer — because `classifyTelegramTurn` returned
`kind:"general"` and the handler had no branch for it. It does now: one
typing indicator, the same brain (the orchestrator short-circuits general
questions itself), the summary as the whole reply.

**Memory.** The bot was stateless between turns: no sessionId (the
orchestrator fell back to "default" while the option store keyed on
`tg:<chatId>`), no conversation context while the web chat builds one from
160 persisted messages. Now: the same chat store (`ensureChat` added — an
idempotent caller-chosen id, because the Telegram chat's one conversation
needs a stable key a minted uuid cannot be), the same context builder, the
same 2,400-token budget, both turns persisted after answering. One memory,
two transports. A context failure logs and never blocks the answer.

**Transport hardening — production bugs, not polish:**
- Model text was interpolated raw into `parse_mode:"HTML"` messages. The
  first summary containing `<` would 400 the send and surface as the generic
  error — for an analysis that succeeded. `escapeTelegramHtml` now wraps
  every model-authored value on the card path (the markup stays literal).
- Nothing split messages at Telegram's 4096 cap; a long answer 400'd the
  send AND its fallback. `sendMessage` now chunks on block boundaries with
  buttons on the last chunk; a long answer discards the bubble (edits cannot
  split) and sends chunks that still quote the question.
- `call()` honors 429 `retry_after` once (capped 15s).
- `editMessageCaption` gains the `parse_mode` its sends always had.
- `setMyCommands(arabicBotCommands())` registers at boot beside the webhook —
  the function existed for exactly this and had no caller, so whatever menu
  users saw was registered out of band and drifted from the classifier.

grammY stays out (the team tried and reverted it in five minutes); everything
here is the raw-fetch client.

## Round 2, Phase D — a live agent, not a bot: no pre-printed thinking anywhere

The owner's correction, verbatim in effect: the Telegram agent must never
show pre-printed thinking — it must show the tasks the agent is ACTUALLY
doing and part of its real thinking; the same applies to the platform's SSE;
and there must be no fixed question-matching ("من انت" and friends). A live
agent, not a bot.

The audit found pre-printed thinking in three places, one of them elaborate:

1. **The web "ticker" was fake thinking with its own LLM bill.** Every run
   paid a model call to PRE-GENERATE a script of plausible thinking lines
   from the request, then `streamTicker` played them on a timer — scrolling
   regardless of what the run was actually doing. Meanwhile the engine's REAL
   narration (`activity` events: sentences authored by each specialist at the
   moment its work finished) was streaming over the same SSE connection,
   collected into state, and never rendered. The ticker module is deleted
   whole (plan generator, streamer, sanitizer, types, its test); the pending
   bubble's live line is now `liveNote` — the latest visible activity
   sentence, set the instant it arrives. The trace header's synthetic
   "يفكّر" fallback and its i18n key are gone too: before the first event the
   empty state shows a bare shimmer, because a status the engine never
   reported is a status we invented.

2. **Telegram's wake/think bubble was two fixed strings.** "أوقظ الوكيل…"
   then "أفكّر…", fired back-to-back at every user before any work happened.
   Deleted. The bubble is now LAZY: it does not exist until the engine's
   first real event creates it. Before that, the native typing indicator is
   the only "working" signal. The bubble renders the task checklist (real
   stage transitions) with the specialist's latest sentence beneath it —
   both narration channels (`emitStage` + visible `emitActivity`) wired in.

3. **The phrase classifier was a bot's reflexes.** GREETING/MENU/SESSION
   phrase lists mapped "مرحبا", "القائمة", "حالة السوق" to canned Arabic
   paragraphs — the same fixed reply forever, drifting from what the agent
   would say, one extra word away from the wrong path. All deleted. Free
   text goes to the agent UNCLASSIFIED; the orchestrator routes
   conversational vs market itself and GENERATES the reply live, exactly as
   the platform chat does. The one mechanical survivor is explicit commands:
   `/chart` (and its exact menu strings) produces a photo the agent cannot
   send as prose; the other commands expand to the Arabic prompt they always
   stood for and ride to the agent as ordinary messages. The conversational/
   analysis split is now decided by what the run RETURNED (`informational` →
   plain generated reply, no cards/chips/tools block), never by guessing the
   question's kind up front — and a conversational run, which emits no
   events by design, never gets a bubble at all: the right theatre falls out
   of honesty instead of classification.

What deliberately stays: `/start`'s link receipt (an auth mechanism's
confirmation, not a reply), the chart command's caption and failure notice
(mechanical command results), and the stage LABELS (a checklist names its
tasks; the narration between them is the agent's own words).

Tests moved with the behavior: the conversation test now pins the
classifier's ABSENCE and that free text reaches the agent untouched; the
liveReply test pins that no status prose exists in the module; liveProgress
pins that the empty render is an empty string and the bubble is born from
the first real event; parity pins the informational-result delivery shape
and both narration wires.

## Round 2, Phase E — Arabic out of system files: the language map + the ratchet

The owner's rule, verbatim in intent: system files must contain no Arabic at
all — Arabic is added to the language map (`src/lib/i18n`), and static texts
must not exist. Two things follow from taking that seriously:

1. **User-facing Arabic becomes i18n data.** Every migrated string now lives
   in BOTH `src/lib/i18n/en.ts` (which defines `TranslationKey`, so the
   compiler enforces parity) and `ar.ts`, and reaches code through
   `t(locale, key, replacements)`. Migrated in this phase, chosen for being
   what the operator actually reads:
   - `markets/tradingCalendar.ts` — the five session-status reasons
     (`session.*`).
   - The whole gate chain — G1–G7 labels, the crash template, both refusal
     composers (`gates/chain.ts`), every per-gate reason in
     `gates/buildGates.ts`, `newsWindow.ts`, `revalidation.ts`,
     `strategyEvidence.ts` (`gate.*`).
   - `closedMarketScenario.ts` — the deterministic scenario notice and the
     synthesizer's scenario preamble (`scenario.*`).
   - `cards/telegramCards.ts` — every card header and phrase, reusing the
     web renderer's existing `agent.card.*` keys where the strings matched
     (`tg.*` where Telegram-specific).
   - `telegram/webhookAgent.ts` + `telegram/conversation.ts` — link prompt,
     receipts, captions, error notices, the tools-block line (`tg.*`).
   - `errorTaxonomy.ts` — both inline ar/en failure-message maps became
     `fault.*` keys; the stage-list joiner is `list.separator` so even the
     comma is locale data.
   - `orchestrator.ts` — all 38 Arabic lines: activity narration templates,
     blocker summaries, restored-recommendation fields, invalidation-rule
     templates (`orch.*`). `bilingual()` survives only where it selects
     between two COMPUTED values (dataQuality coverage summaries).
   - `evidenceCard.ts` summary line (`evidence.*`),
     `sessionRecommendation.ts` direction words (reuses `decision.*`).

2. **The ratchet** (`src/lib/__tests__/arabicInSystemFiles.test.ts`, in
   `test:guards`). The rule cannot be applied retroactively in one sweep —
   ~240 files still carry ~2,060 Arabic lines — so the guard records the
   debt per file (`arabicBaseline.json`) and fails on: Arabic in any file
   NOT in the baseline; any recorded file whose count GROWS; and any
   baseline entry LARGER than reality (so the recorded debt is always the
   real debt and can only move toward zero). Probed before trusting: an
   injected new-file violation and an injected count increase were both
   caught. Exempt as language data, not exceptions to the rule:
   `src/lib/i18n/**`, `telegram-ar-commands.json` (menu vocabulary),
   `landingCopy.ts` (structured bilingual content map), and test files
   (they pin Arabic behavior).

Dead code found by the migration and deleted rather than translated:
`telegramCommands.ts` lost its execution-era surface (approval/positions
buttons, the callback→command map, reply-keyboard rows — zero importers, all
promising trade execution the platform doesn't do); `lib/telegramCards.ts`
lost `approvalCard`, `tradeResultCard`, `balanceCard`, `cancelledTradeCard`,
`menuCard`, `formatAmount` and `telegram.ts` its re-export of the first two
(zero importers). `CHART_ACTION` is now exported from `telegramCommands.ts`
off the menu JSON instead of being duplicated as a literal in
`conversation.ts`.

Deliberately NOT migrated (recorded in the baseline instead): input-matching
vocabulary (`intentRouter.ts`'s 156 lines match what USERS type — that is a
classifier's data, not output; same for the Arabic keyword in
`errorTaxonomy`'s auth matcher), admin panels, and the long tail. The
baseline is the worklist; the guard guarantees it only shrinks.
