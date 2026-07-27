# Local and VPS Validation — Unified Agent

Code completeness does **not** imply operational readiness. This checklist is the operational gate after **Local Release Qualification** (`docs/LOCAL_RELEASE_QUALIFICATION.md`).

`AUTO_EXECUTION_STAGE` must remain `off` until the owner explicitly promotes dry-run → demo → live.

**GitHub Actions:** Automatic execution is intentionally disabled by owner decision (account billing lock). Official verification is the full local matrix. Do not treat red PR checks as a code defect. Do not fix GitHub billing as part of engineering PRs. Manual `workflow_dispatch` remains available on `.github/workflows/ci.yml`.

---

## يمنع النشر على VPS

These must pass before deploying application code to the VPS.

| Item | Requirements | Commands / verify |
|---|---|---|
| PostgreSQL migration test | Prod DB reachable; migrations apply cleanly | Run migration job; verify schema + critical tables |
| Environment Variables | All required secrets present (DB, auth, broker bridge, alerts) | Diff against `.env.example` / deploy checklist; no stubs |
| Production build | TradingView library provisioned; `npm run build` succeeds | `cd web && npm run provision:tradingview && npm run build` |
| Redis | Reachable from web process | Health ping; session / rate-limit smoke |
| Cron | Reevaluate + weekly report schedulers installed | systemd timers / cron entries present and logged |
| Reverse proxy | Host routes to app | nginx/caddy config reload OK |
| SSL | Valid cert | HTTPS handshake + expiry check |

**Also required before VPS:** Local Release Qualification green (lint, typecheck for app code, `test:ci`, MCP catalog/schemas). Redis integration test when Docker available.

---

## يمنع Auto Dry-run

Do not set `AUTO_EXECUTION_STAGE=dry-run` until:

| Item | Why |
|---|---|
| EA / bridge connection | Live path to MT5 terminal |
| Verified broker account state | Account type + identity confirmed by server |
| Live quotes | Fresh bid/ask; heartbeat OK |
| Execution stage configuration | Stage explicitly `dry-run`; kill switch off |
| Portfolio gates | Risk %, daily cap, max positions configured |
| Kill switch | Verified can halt |
| Notifications | Telegram/push deliver at least one test alert (or silent mode intentional) |

---

## يمنع Demo

Do not set `AUTO_EXECUTION_STAGE=demo` until dry-run period is acceptable **and**:

| Item | Why |
|---|---|
| Broker demo execution | Order create works on demo |
| Order modify / close | Management path verified |
| Disconnect downgrade | Account disconnect forces WAIT / blocks auto |
| Stale revision against real bridge | `stale_revision` rejects wrong revision_no on live path |

---

## يمنع Live

Do not set `AUTO_EXECUTION_STAGE=live` until:

| Item | Why |
|---|---|
| Successful dry-run period | Owner-reviewed window with no critical incidents |
| Successful demo period | Real demo fills/exits reviewed |
| Owner approval | Explicit written go-live |
| Risk limits | Risk per trade + portfolio caps |
| Daily cap | Loss / trade-count caps armed |
| Rollback plan | Stage revert to `off` / `dry-run` documented |
| Monitoring | Logs, alerts, journal visibility |

---

## Legend (detail rows below)

| Field | Meaning |
|---|---|
| Where | Local workstation or VPS |
| Blocks | `deploy` / `dry-run` / `demo` / `live` / none |

---

## Detail: PostgreSQL production migration

| | |
|---|---|
| Where | VPS |
| Requirements | Prod Postgres reachable; migrations apply cleanly |
| Verify | Schema matches expected; recommendations / revisions / notifications tables present |
| Blocks | **deploy** |

## Detail: Environment variables

| | |
|---|---|
| Where | VPS |
| Requirements | Full secret set; no TradingView stubs; `AUTO_EXECUTION_STAGE=off` initially |
| Blocks | **deploy** |

## Detail: Production build (TradingView)

| | |
|---|---|
| Where | Local or VPS with secrets |
| Commands | `cd web && npm run provision:tradingview && npm run build` |
| Note | Absence of secrets ⇒ Operational Verification Pending — do **not** stub |
| Blocks | **deploy** |

## Detail: Redis

| | |
|---|---|
| Where | Local (Docker) or VPS |
| Local command | `docker run --rm -d --name aichart-test-redis -p 6379:6379 redis:7-alpine` then `REDIS_URL=redis://127.0.0.1:6379 npm run test:integration` |
| Blocks | **deploy** (and confidence for rate limits / sessions) |

## Detail: Manual GitHub Actions (optional)

| | |
|---|---|
| Where | GitHub → Actions → CI → Run workflow |
| Requirements | Billing unlocked (owner) |
| Blocks | **none** for merge — local matrix is authoritative |

## Detail: Branch protection manual action

If branch protection still requires GitHub status checks that never run:

1. GitHub → Settings → Branches → protection rule for the target branch
2. Remove or relax required checks that depend on automatic Actions
3. Rely on Local Release Qualification + human review

Do **not** change repo settings from automation unless the owner asks.

---

## Current pass notes (2026-07-27 / Clean Qualification + Human Review)

- Full local matrix is the merge gate (see `LOCAL_RELEASE_QUALIFICATION.md`).
- Qualification ran on the **VPS** (Node 22, Docker, licensed TradingView library present) in an isolated detached `git worktree` at `/root/aichart-qualification-996dcb`, outside `/opt/aichart`. The live pm2 services and the production `aichart-redis-rel` container were never touched.
- **Redis integration: VERIFIED** — real `redis:7-alpine` on a throwaway port, 3/3 pass, no skip, container removed.
- **TradingView production build: VERIFIED** — `npm run build` Exit 0 against the licensed library, no stub, nothing committed.
- **Full typecheck: VERIFIED** — `npx tsc --noEmit` Exit 0, clean.
- GitHub Actions automatic triggers: disabled (`workflow_dispatch` only).

### Still requiring a real environment

Everything below is genuinely untested here and stays `operational-only`. None of it blocks code review or merge; the first three block VPS deployment.

| Item | Where | Command / action | Blocks |
|---|---|---|---|
| PostgreSQL migration | VPS, safe DB copy | apply migrations, then `npm run test:postgres-release` (now asserts the live `SCHEMA_VERSION`) | deploy |
| Environment variables | VPS | full secret set; `AUTO_EXECUTION_STAGE=off` initially | deploy |
| Cron / reverse proxy / SSL | VPS | already provisioned in production; re-verify after deploy | deploy |
| pgvector | VPS Postgres | `CREATE EXTENSION vector`; confirm HNSW/ivfflat or the JS fallback | dry-run |
| MT5 / EA / broker demo | VPS + terminal | bridge up, verified account, live quotes | dry-run → demo |
| Telegram / Push / Service Worker | VPS + real browser | one delivered test alert per channel | dry-run |
| disconnect / reconnect | VPS | auto must drop to advisory and must NOT self-restore | demo |
| `stale_revision` against the real bridge | VPS | wrong `revision_no` must be refused on the live path | demo |
| dry_run → demo → live | VPS | owner promotes the stage explicitly, one step at a time | live |
