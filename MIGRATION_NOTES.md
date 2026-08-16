
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
