# Lonora — CI & Deployment Runbook

This document covers what CI needs, the required secrets, the scheduler, and the
manual verification runbooks (Playwright + live voice) that require a running
preview environment.

## Test commands (web)

| Command | Scope | Services | Notes |
|---|---|---|---|
| `npm run lint` | ESLint | none | Exits 0. Experimental React-Compiler rules (`set-state-in-effect`, `purity`) and `no-explicit-any` are **warnings** by explicit policy in `eslint.config.mjs`; `rules-of-hooks`, `refs` (render-time ref access), `immutability` (render-time mutation) stay blocking. |
| `npm run test:unit` | Deterministic unit suite (290 tests) | none | ~7s, exits cleanly (`--test-force-exit`). |
| `npm run test:integration` | Redis-dependent (eaLiveState, queue/BullMQ) | Redis | Explicitly **skips** the BullMQ round-trip with a reason when `REDIS_URL` is unreachable. |
| `npm run test:live` | Opt-in external-provider tests | provider keys | No-op by default; set provider env to run targeted suites. |
| `npm run test:ci` | `test:unit` + `test:integration` | Redis | The CI aggregate. |
| `npm run build` | `next build` | **licensed TradingView library** | Requires provisioning (below). |

MCP: `npm run typecheck`, `npm run test:catalog`, `npm run schemas:check` — all green.

## TradingView library provisioning (required for build)

The proprietary TradingView Advanced Charts library is **licensed and gitignored**
— never committed. CI/deploy fetches it from a private source before building.

**Required secrets** (repository or organization level; never printed):

- `TRADINGVIEW_LIBRARY_URL` — authenticated URL of the licensed archive
  (`.tgz`/`.tar.gz`/`.zip`): a private registry, a signed object-storage URL, or
  the licensed source.
- `TRADINGVIEW_LIBRARY_TOKEN` — *(optional)* bearer token when the URL is not
  pre-signed.

`npm run provision:tradingview` downloads + extracts the archive into
`src/vendor/tradingview/charting_library/` (typings) and `public/charting_library/`
(runtime), verifies the expected files exist, and **fails early with a clear
message** when the secret/files are absent (no cryptic module-not-found, no
secret echoing). The CI `web` job runs it before `build`; lint and tests run
first and do not need the library.

> The exact archive layout must resolve `@/vendor/tradingview/charting_library`
> (typings) and serve `/charting_library/charting_library.standalone.js` (runtime).
> Configure the licensed artifact accordingly; the verify step guards the build.

## Recommendation-tracker scheduler

`POST /api/cron/recommendation-sweep` — authenticated with `CRON_SECRET`,
overlap-safe via a distributed lease lock, evaluates all non-terminal tracked
recommendations against fresh warehouse candles. **No browser, no LLM, no trade
execution.** Idempotent; safe no-op when nothing is active.

Scheduled from the VPS crontab (`infra/aichart.cron`, `infra/crontab.example`)
every 5 minutes:

```cron
*/5 * * * * root curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://YOUR_DOMAIN/api/cron/recommendation-sweep >/dev/null 2>&1
```

Health check / manual invocation:

```bash
# Unauthorized → 401
curl -i -X POST https://YOUR_DOMAIN/api/cron/recommendation-sweep
# Authorized → { "ok": true, "checked": N, "updated": N, "terminal": N, "durationMs": N }
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://YOUR_DOMAIN/api/cron/recommendation-sweep
```

## Required deployment / preview environment variables

Voice: `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`,
`VOICE_SESSION_MAX_MINUTES`, `VOICE_IDLE_TIMEOUT_SECONDS`,
`VOICE_MAX_RECONNECT_ATTEMPTS`, `VOICE_SAFETY_SALT`.
Scheduler: `CRON_SECRET`. Support contacts: `SUPPORT_EMAIL`, `SUPPORT_TELEGRAM`
(Lonora defaults). Build: `TRADINGVIEW_LIBRARY_URL` (+ `TRADINGVIEW_LIBRARY_TOKEN`).
Platform: DB (SQLite dev / Postgres prod via `DATABASE_URL`), `REDIS_URL`
(optional worker tier), OANDA, MT5/EA bridge (`MT5_BRIDGE_URL`), news provider,
`AICHART_SERVICE_TOKEN` (MCP↔web bridge), `MCP_AUTH_MODE`.

Migrations for `agent_chats`, `agent_chat_messages`, `tracked_recommendations`
run automatically via `initDb()` on both the SQLite and Postgres paths.

## Playwright browser verification (manual — needs a preview)

Playwright cannot run in the build sandbox: it requires a **running app**, which
requires the licensed TradingView library. The dev/test-only read-only bridge
`window.__LONORA_AGENT_DEBUG__.snapshot` is in place to drive assertions
(symbol, interval, chart candle/close, visible range, drawing/user/agent counts,
active recommendation, chat id, locale, mobile pane, voice status, redacted last
result) without scraping the DOM or touching trading logic.

Runbook (in a preview with the library provisioned):

```bash
npm i -D @playwright/test && npx playwright install --with-deps chromium
# Desktop (chromium) + mobile (Pixel 5) projects, trace+screenshot on failure.
# Assert via: await page.evaluate(() => window.__LONORA_AGENT_DEBUG__.snapshot)
```

Scenarios: Arabic/English + RTL/LTR, chat create/reload/switch, profile menu,
dynamic suggestions only (no static quick actions), thinking ticker in the
assistant bubble, collapsed activity, desktop resizable chat + persisted width,
mobile Chart/Chat tabs (no side-by-side), drawing toolbar desktop-only,
recommendation tracker/list/stats/empty/filters, user-drawing discuss/mutate/
delete, and voice UI (mock media/WebRTC) permission→connecting→listening→mute→
speaking→interrupt→reconnect→stop with text chat still usable after an error.

## Live voice verification (manual — needs a real key + microphone)

Cannot run in the sandbox. In a secure preview (HTTPS/localhost) with a real
`OPENAI_API_KEY` and microphone, on Chrome desktop or Android Chrome (plus one of
Safari/Firefox): start a session, speak Arabic + English, ask a chart question,
confirm the public agent answer is spoken, test barge-in, mute/unmute, reconnect,
stop/cleanup, and confirm in the browser Network panel that only the ephemeral
`ek_...` client secret reaches the browser — never the standard API key.
