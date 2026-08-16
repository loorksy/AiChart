
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
