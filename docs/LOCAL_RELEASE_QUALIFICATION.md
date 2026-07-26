# Local Release Qualification — Official Verification Gate

This document is the **official release qualification record** for PR #82 while GitHub Actions automatic execution is disabled by owner decision (billing lock on the GitHub account). GitHub CI is **not** required for merge readiness.

`AUTO_EXECUTION_STAGE` remains `off`.

---

# Environment

| Item | Value |
|---|---|
| OS | Windows 10 (win32 10.0.26200) |
| Node | v25.2.1 |
| npm | 11.6.2 |
| Database used | In-memory / vitest mocks for unit+contract; PostgreSQL not exercised in this pass |
| Redis state | **Not available** (Docker not installed; `ECONNREFUSED 127.0.0.1:6379`) |
| Docker | Not available (`docker` command missing) |
| TradingView secrets | **Absent** (`TRADINGVIEW_LIBRARY_URL` / `TRADINGVIEW_LIBRARY_TOKEN` unset) |
| Worktree | `.claude/worktrees/aichart-agent-updates-test-b3e068` |
| Branch | `claude/aichart-agent-development-plan-mflw6l` |
| Commit SHA | *(see Git section after push; qualification SHA at doc commit)* |

---

# Commands

## Web

```bash
cd web
npm ci --no-audit --no-fund   # preferred; existing node_modules used when clean install blocked
npm run lint                  # EXIT 0
npx tsc --noEmit              # EXIT 2 — TradingView charting_library modules only
npm run test:ci               # EXIT 0 — 820 unit/contract + 79 decision-authority + integration subset
# Redis (when Docker available):
# docker run --rm -d --name aichart-test-redis -p 6379:6379 redis:7-alpine
# REDIS_URL=redis://127.0.0.1:6379 npm run test:integration
# docker stop aichart-test-redis
# Build (when TradingView secrets available):
# npm run provision:tradingview && npm run build
```

## MCP

```bash
cd mcp
npm ci --no-audit --no-fund
npm run typecheck
npm run test:catalog
npm run schemas:check
```

---

# Web Results

| Command | Exit | Passed | Failed | Skipped | Duration | Notes |
|---|---|---|---|---|---|---|
| `npm run lint` | 0 | n/a | 0 errors | n/a | ~minutes | warnings only |
| `npx tsc --noEmit` | 2 | n/a | TradingView missing modules only | n/a | ~45s | No errors in agent/analytics/coverage files |
| `npm run test:ci` (unit/contract batch) | 0 | 820 | 0 | 0 | ~161s | includes coverage + critical integration |
| `npm run test:ci` (decision-authority) | 0 | 79 | 0 | 0 | ~16s | part of `test:ci` script chain |
| `npm run test:integration` (inside `test:ci`) | 0 | 2 | 0 | 1 | ~6s | BullMQ skipped — Redis unreachable |
| `npm run build` | **Pending** | — | — | — | — | Secrets absent — no stub library |

### Targeted coverage gates

| Suite | Exit | Passed | Failed | Skipped |
|---|---|---|---|---|
| `referenceScenarioCoverage.test.ts` | 0 | 5 | 0 | 0 |
| `criticalReferenceScenarios.integration.test.ts` | 0 | 10 | 0 | 0 |
| `referenceScenarios.integration.test.ts` | 0 | 7 | 0 | 0 |
| `doctrineGuard.test.ts` | 0 | 4 | 0 | 0 |

---

# MCP Results

| Command | Exit | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|---|
| `npm run typecheck` | 0 | n/a | 0 | 0 | clean |
| `npm run test:catalog` | 0 | 98 | 0 | 0 | catalog parity |
| `npm run schemas:check` | 0 | 57 tools OK | 0 | 0 | no drift |

---

# Scenario Coverage

| Metric | Count |
|---|---|
| Registry scenarios (`REFERENCE_SCENARIOS`) | 30 |
| Covered scenarios (coverage map owners) | 30 |
| Uncovered scenarios | 0 |
| Critical integration scenarios | 18 listed + exercised by map |
| Coverage guard tests | 5 (all pass) |

Coverage map: `web/src/lib/agent/__tests__/fixtures/referenceScenarioCoverage.ts`  
Guard: `web/src/lib/agent/__tests__/referenceScenarioCoverage.test.ts`  

Fails when: missing owner, orphan owner, empty expected/forbidden, DB/lifecycle without integration, critical without integration.

---

# Operationally Pending

| Item | Status | Later command / action |
|---|---|---|
| TradingView build | Pending secrets | Set `TRADINGVIEW_LIBRARY_URL` + `TRADINGVIEW_LIBRARY_TOKEN`; `cd web && npm run provision:tradingview && npm run build` |
| PostgreSQL | Pending VPS/local | Apply migrations; run DB-backed integration |
| pgvector | Pending | Enable extension or confirm text fallback path in prod |
| Redis (full integration) | Pending Docker | `docker run --rm -d --name aichart-test-redis -p 6379:6379 redis:7-alpine` then `REDIS_URL=redis://127.0.0.1:6379 npm run test:integration` then `docker stop aichart-test-redis` |
| MT5 / broker | Pending | Bridge + verified account |
| Telegram / Push | Pending | Credentials + delivery smoke |
| SSL / reverse proxy | Pending VPS | nginx + certbot |
| Cron | Pending VPS | systemd timers for reevaluate / weekly report |
| dry-run / demo / live | Blocked | Keep `AUTO_EXECUTION_STAGE=off` until gates in `LOCAL_AND_VPS_VALIDATION.md` |

---

# GitHub Actions (owner decision)

- Automatic `push` / `pull_request` triggers: **DISABLED**
- Workflow file retained: `.github/workflows/ci.yml`
- Trigger: `workflow_dispatch` only (manual)
- Job steps preserved (web lint/tsc/tests/build, MCP typecheck/catalog/schemas, Redis service for manual runs)
- Branch protection: if status checks still require Actions jobs, **owner must adjust GitHub Settings manually** — not a code defect

---

# Three last programming items (re-verified)

| Item | Status | Evidence |
|---|---|---|
| `opportunity_created` exactly once | `implemented` | `announceOpportunityCreated`; chart adapter uses same path; tests green |
| Canonical late-entry / early-exit | `implemented` | `canonical/analytics.ts`; journal via `summarizeAdherence`; UI reads counts |
| Reference fixture pack | `implemented` | 30 scenarios + controlled adapter constraints + coverage map |

---

# Verdict snapshot

See the Final Qualification report in the agent session / PR for Executive Verdict fields. Official gate = this local matrix, **not** GitHub Actions.
