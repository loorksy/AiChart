# Local and VPS Validation — Unified Agent

Code completeness does **not** imply operational readiness. This checklist covers every item that must be verified outside Cursor / unit CI.

`AUTO_EXECUTION_STAGE` must remain `off` until the owner explicitly promotes dry-run → demo → live.

---

## Legend

| Field | Meaning |
|---|---|
| Where | Local workstation or VPS |
| Blocks | `merge` / `deploy` / `live` / none |

---

## 1) GitHub Actions billing unlock

| | |
|---|---|
| Where | GitHub account / org billing |
| Requirements | Resolve account lock; Actions minutes available |
| Env | n/a |
| Commands | Re-run PR #82 checks after unlock |
| Verify | Jobs show runners + steps; Web checks / MCP checks complete |
| Expected | Green lint/typecheck/tests (TradingView build may still need secrets) |
| Rollback | n/a |
| Risk | Low for code; high for release confidence |
| Blocks | **merge** (until green or documented external-only) |

**Current finding (2026-07-26):** CI fails in ~1s with empty steps. Annotation: *The job was not started because your account is locked due to a billing issue.* Not a code defect.

---

## 2) PostgreSQL production migration

| | |
|---|---|
| Where | VPS |
| Requirements | Postgres reachable; app user with DDL |
| Env | `DATABASE_URL` |
| Commands | App boot / migrate path used in deploy |
| Verify | `\d recommendations` shows additive columns (`plan_type`, `evidence_source`, `effective_revision_no`, …); `recommendation_revisions`, `alert_dedupe`, `decision_parity*` exist |
| Expected | No dropped tables; SQLite→PG parity of additive schema |
| Rollback | Feature flags OFF; do not delete columns |
| Risk | Medium |
| Blocks | **deploy** |

---

## 3) `CREATE EXTENSION vector` + HNSW/ivfflat

| | |
|---|---|
| Where | VPS Postgres |
| Requirements | Superuser or granted `CREATE` on extension |
| Env | `DATABASE_URL` |
| Commands | `CREATE EXTENSION IF NOT EXISTS vector;` then app case-memory path |
| Verify | `\dx vector`; `market_cases.embedding` type `vector`; index present or JS fallback logged |
| Expected | KNN works when extension present; graceful JS fallback otherwise |
| Rollback | Leave extension; app falls back automatically |
| Risk | Medium |
| Blocks | **deploy** (similarity quality); not merge |

---

## 4) Redis

| | |
|---|---|
| Where | Local + VPS |
| Requirements | Redis 7+ |
| Env | `REDIS_URL=redis://127.0.0.1:6379` |
| Commands | Local: `REDIS_URL=... npm run test:integration` (web) |
| Verify | Queue + EA live-state tests pass (not skipped) |
| Expected | Locks / queues healthy |
| Rollback | App degrades per existing matrix |
| Risk | Medium |
| Blocks | **deploy** for distributed locks |

---

## 5) TradingView licensed build

| | |
|---|---|
| Where | GitHub Secrets + CI / VPS build |
| Requirements | Licensed library URL + token |
| Env | `TRADINGVIEW_LIBRARY_URL`, `TRADINGVIEW_LIBRARY_TOKEN` |
| Commands | `cd web && npm run provision:tradingview && npm run build` |
| Verify | Build succeeds; chart module resolves |
| Expected | No stub library in production |
| Rollback | Do not ship chart UI without provision |
| Risk | High for chart UI deploy |
| Blocks | **deploy** of web chart; typecheck/tests can run without it |

---

## 6) MT5 / EA / Demo / Live broker

| | |
|---|---|
| Where | VPS + broker terminal |
| Requirements | EA online, heartbeat, demo then live accounts |
| Env | Bridge / EA secrets per deploy docs |
| Commands | Connect EA → `get_account_overview` / trade readiness |
| Verify | Heartbeat fresh; account type detected from broker (not env lie) |
| Expected | Analysis works disconnected; execution controls only when connected |
| Rollback | Disconnect EA; keep `AUTO_EXECUTION_STAGE=off` |
| Risk | **Critical** for money |
| Blocks | **live**; demo blocks demo promotion |

---

## 7) Telegram + Web Push + Service Worker

| | |
|---|---|
| Where | Local/VPS + real devices |
| Requirements | Bot token; VAPID keys; browser permissions |
| Env | `TELEGRAM_BOT_TOKEN`, push VAPID pair |
| Commands | Create recommendation → one `opportunity_created`; revise → revised event |
| Verify | `alert_dedupe` one row per `(rec, event, revision)`; push on Chrome/Android; iOS via Add to Home Screen |
| Expected | No duplicate birth alerts; silent mode respected |
| Rollback | `REC_LIFECYCLE_ALERTS_V1=0` or user alert prefs off |
| Risk | Medium |
| Blocks | none for merge; **deploy** for notification UX |

---

## 8) VPS cron / reverse proxy / SSL

| | |
|---|---|
| Where | VPS |
| Requirements | systemd/cron, nginx/caddy, certificates |
| Env | Public URL, TLS |
| Commands | Confirm tracker cron (~5m), strategy-pipeline, weekly report Sunday 18:00 |
| Verify | Logs show sweeps; HTTPS healthy |
| Expected | Lifecycle transitions notify once |
| Rollback | Stop cron units |
| Risk | Medium |
| Blocks | **deploy** |

---

## 9) Disconnect / reconnect broker test

| | |
|---|---|
| Where | VPS + EA |
| Requirements | Auto mode set with stable connection |
| Env | `AGENT_TRADE_MODE_V1` on; `AUTO_EXECUTION_STAGE` still `off` or dry-run only |
| Commands | Set auto → kill EA heartbeats (3) → observe drop to advisory |
| Verify | Audit event + notification; auto not restored silently on reconnect |
| Expected | No execution after disconnect |
| Rollback | Keep advisory |
| Risk | High |
| Blocks | **demo/live** |

---

## 10) Dry-run → Demo → Live ladder

| Stage | Env | Blocks |
|---|---|---|
| `AUTO_EXECUTION_STAGE=off` | default | none — **required for merge** |
| `dry_run` | logs “would execute” only | deploy validation |
| `demo` | demo broker only | owner gate |
| `live` | live broker | **owner-only**; never from CI |

---

## Quick local resume

```bash
cd web
npm ci --no-audit --no-fund
npm run lint
npx tsc --noEmit
npm run test:ci

cd ../mcp
npm ci --no-audit --no-fund
npm run typecheck
npm run test:catalog
npm run schemas:check
```

Optional: `REDIS_URL=redis://127.0.0.1:6379 npm run test:integration` from `web/`.
