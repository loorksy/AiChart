# AiChart simplification conflict audit

Date: 2026-07-16

This audit is the implementation boundary for the coordinated trading-decision and product-UX refactor. Repository code and runtime behavior take precedence over older reports.

## Priority resolution

1. Preserve production data, authentication, tenant/account ownership, and technical execution safety.
2. Make the canonical AI agent the sole analytical authority for BUY, SELL, conditional BUY, conditional SELL, and WAIT.
3. Retain exactly one trading preference: Risk per Trade (%), used only for position sizing.
4. Make scalping the only operating style while retaining higher-timeframe evidence.
5. Preserve real chart, conversation, recommendation, execution, voice, research, trace, and administration capabilities.
6. Remove obsolete policy authority and simplify the normal-user experience.

## Conflict decisions

- Existing recommendation, trade, execution, conversation, audit, replay, and research records are historical evidence and must not be deleted. Forward migrations may remove obsolete settings authority without deleting those records.
- `admin_limits.can_execute` is execution authorization, not recommendation policy, and remains technical safety. Capital, position-count, leverage, and recommendation-policy caps lose all runtime authority and are removed by forward migration.
- Profile, locale, theme, alert delivery, and connection preferences are account/application settings. They are not trading-policy controls. The only trading preference shown or accepted is Risk per Trade (%).
- The MCP route remains role-protected technical functionality because the preservation requirement explicitly names it. It is excluded from normal-user navigation and language.
- Invalid or unrecoverably stale market data may stop unsupported analysis. EA disconnection, account authorization failure, broker failure, or sizing failure may stop execution only; none may rewrite an analytical BUY/SELL/WAIT opinion.
- Scalping is a fixed product constant. Higher timeframes remain evidence inputs for structure, levels, volatility, and reaction zones; they are not selectable trading modes.
- Normal market explanations and follow-up suggestions are model-composed from user-safe facts. Deterministic connection/voice states remain short localized UI status labels for latency and accessibility, with no provider or transport terminology.
- The chart route must render one mobile drawer at a time. Its navigation derives from the same canonical route configuration as desktop/console navigation, while conversation history is injected as dynamic drawer content.

## Legacy dependency classification

Remove runtime authority and public mutation support:

- trading mode/style/profile selectors and persisted cadence correction;
- daily/monthly profit or loss limits, maximum positions/trades, capital ceiling;
- recommendation-confidence, setup/data/zone score, and fixed R:R gates;
- user/admin policy precedence, policy-based WAIT conversion, and risk veto semantics;
- user kill switch, execution-environment preference, scan interval, symbol restriction, and news blackout as recommendation policy;
- dedicated Risk Guard status/settings surface and user-facing implementation terminology;
- policy-specific API routes for mode, style, risk guard, and risk status.

Retain as technical execution safety:

- authentication, tenant/account ownership, explicit confirmation, authorization;
- symbol/broker normalization, order schema and numeric validation;
- mandatory stop loss for sizing/order validity;
- fresh bid/ask, connection/account/environment integrity;
- idempotency, duplicate/stale order protection, broker reconciliation.

Retain as evidence only:

- historical comparison, Backtest, Validation, Trading DNA, Shadow analysis, Research Swarm, and Deep Analysis;
- structure, trendline, candle, liquidity, volatility, news, and higher-timeframe evidence;
- confidence/data/setup-quality semantics after the analytical opinion is formed.

## Migration rule

The fresh schema omits obsolete policy columns. Existing installations upgrade through a new forward-only migration marker. Historical recommendation/execution fields remain available to replay, audit, statistics, and reporting. Obsolete mutation fields are rejected rather than accepted silently.

## Route inventory

Canonical user routes:

- `/console`: authenticated chat-first chart workspace.
- `/chart` and `/chart/[symbol]`: public/auth-aware chart entry points using the same workspace.
- `/console/settings`: Risk per Trade (%) and application/account preferences.
- `/console/settings/profile`, `/console/settings/alerts`, `/console/connect`.
- `/console/recommendations`, `/console/trades`, `/console/account`, `/statistics`.
- `/login`, `/signup`, `/complete-profile`, `/awaiting-approval`.

Role-protected technical/admin routes retained:

- `/console/mcp`, `/console/platform`, `/console/pages`.

Compatibility redirects retained to avoid breaking saved links:

- `/chat` → `/chart`.
- `/dashboard`, `/signals`, `/signals/new`, `/reports` → `/console`.
- `/market` → `/console` for authenticated users, otherwise `/login`.
- `/onboarding` → access check, then `/console`.
- `/plan` → `/console/platform?tab=profile`.
- `/settings` → the matching canonical `/console/settings*` route.
- `/trades` → `/console/trades`.

The standalone tracked-recommendation detail routes remain because they preserve historical evidence and deep links. They do not create a second analytical decision surface.

Deleted public/API surfaces include mode/style selection, Risk Guard settings/status, execution-environment selection, pending-order creation, legacy signal generation, onboarding suggestions, the old market-analysis engine, and the copilot/committee test surfaces.

## Validation evidence

Verified locally on 2026-07-16:

- Web TypeScript: passed.
- Web `test:ci`: passed all context, memory, skills, tools, trace, research, recommendation, Trading DNA, unit, and integration phases. Unit result: 261/261. Integration result: 2 passed, 1 Redis round-trip skipped because no Redis server was available; the no-Redis inline fallback passed.
- Final-decision authority regression suite after the last authority fix: 34/34 passed. It verifies that news, spread, higher-timeframe conflict, weak POIs, and limited coverage remain evidence rather than vetoes, and that a model BUY/SELL opinion is not silently converted to WAIT when executable levels are unavailable.
- Web production build: passed.
- MCP TypeScript and schema/contract parity: passed.
- MCP catalogue: 70/70 passed.
- SQLite fresh schema: passed. `trading_settings` contains `per_trade_pct` plus watchlist/connection/notification application fields and has no stored `active_market`; removed engine tables are not created.
- SQLite upgrade fixture: passed. Legacy policy columns, committee data, and risk-veto columns were removed; invalid Risk per Trade was normalized to 1%; watchlist data and historical engine tables were preserved rather than destructively dropped.
- Production runtime smoke test on an isolated temporary SQLite database: health, public pages, redirects, registration, login, authenticated console pages, account/status APIs, and settings persistence passed.
- Settings contract runtime proof: accepted `per_trade_pct=2.3`; rejected `0`, `1.25`, and the removed `mode` field; GET returned no `active_market`.

Not verified locally:

- PostgreSQL live fresh/upgrade execution, because this workstation had no `DATABASE_URL`, `psql`, Docker, or running PostgreSQL. PostgreSQL schema/migration code passed TypeScript, build, and static contract checks only.
- Redis network round-trip, because Redis was not running.
- In-app visual/browser interaction, because the browser skill's required browser-control channel was not exposed in this session. No substitute visual claim is made.
- External LLM, OANDA/MT5/EA, Telegram, voice-provider, and production deployment flows, because their live credentials/services were not exercised.

## Release gate

No pull request, merge, or production deployment is permitted from this audit state. The remaining PostgreSQL, Redis, visual browser, and credentialed live-provider checks must pass before release.
