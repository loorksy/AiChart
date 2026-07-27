# Local Release Qualification — Official Verification Gate

This document is the **official release qualification record** for PR #82 while GitHub Actions automatic execution is disabled by owner decision (billing lock on the GitHub account). GitHub CI is **not** required for merge readiness.

`AUTO_EXECUTION_STAGE` remains `off`.

---

# Verdict

| Judgment | Value |
|---|---|
| Clean Install Verified | **YES** |
| Node 22 Verified | **YES** |
| Web Lint Verified | **YES** |
| Full Typecheck Verified | **YES** |
| Web Test Matrix Verified | **YES** |
| MCP Verified | **YES** |
| Redis Verified | **YES** |
| Production Build Verified | **YES** |
| Core Local Matrix Complete | **YES** |
| Full Local Verification Complete | **YES** |
| Human PR Review Complete | **YES** |

Every row above was produced by running the command on a **clean worktree with a fresh `npm ci`**, on **Node 22**, with the **licensed TradingView library present**. No stub, no reused `node_modules`, no skipped Redis test.

---

# Environment

The prior qualification pass ran on a Windows workstation with Node 25, no Docker, and no TradingView library, which is why it could not complete typecheck, build, or Redis. This pass ran on the project's own Linux VPS, which already has all three.

| Item | Value |
|---|---|
| Host | AiChart VPS (Linux) |
| Node | **v22.22.2** |
| npm | 10.9.7 |
| Worktree | `/root/aichart-qualification-996dcb` — detached `git worktree`, created fresh from the qualification SHA |
| Isolation | Outside `/opt/aichart`; the live `aichart-web` / `aichart-mcp` / `aichart-worker` pm2 services were never touched |
| Database | SQLite (per-test temp files); PostgreSQL not exercised in this pass |
| Redis | **Available** — throwaway `redis:7-alpine` container on port 16379/16380, removed after use. The production `aichart-redis-rel` container was never used or modified |
| TradingView library | **Present** — the licensed copy already on the VPS, copied into the worktree at `web/public/charting_library/` and `web/src/vendor/tradingview/`, both confirmed git-ignored |
| Branch | `claude/aichart-agent-development-plan-mflw6l` |
| Qualification SHA | `ad38243` (baseline) → `29eb20a` (after review fixes) |

`node_modules` was **not** copied, symlinked, or reused from any existing checkout.

---

# Commands

## Web

```bash
cd web
npm ci --no-audit --no-fund
npm run lint
npx tsc --noEmit
npm run test:ci
npm run build
```

Redis integration (real instance, no skip):

```bash
docker run --rm -d --name aichart-qualification-redis -p 16379:6379 redis:7-alpine
REDIS_URL=redis://127.0.0.1:16379 npm run test:integration
docker stop aichart-qualification-redis
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

# Clean Installation

| Package | Node | npm ci | Exit | Duration | Notes |
|---|---|---|---|---|---|
| web | v22.22.2 | clean, from lockfile | 0 | ~65s | 769 packages; no pre-existing `node_modules` |
| mcp | v22.22.2 | clean, from lockfile | 0 | ~5s | 135 packages; no pre-existing `node_modules` |

---

# Web Results

Measured at `29eb20a` (post-fix). Baseline `ad38243` produced the same results except for the three tests added by the review fixes.

| Command | Exit | Passed | Failed | Skipped | Duration | Notes |
|---|---|---|---|---|---|---|
| `npm run lint` | 0 | n/a | 0 errors | n/a | 28s | 155 warnings, 0 errors |
| `npx tsc --noEmit` | **0** | n/a | 0 | n/a | 5–18s | **Clean** — the licensed library resolves; no TradingView module errors |
| `npm run test:ci` (unit/contract) | 0 | **823** | 0 | 0 | 81s | includes coverage guard + critical integration |
| `npm run test:ci` (decision-authority) | 0 | 79 | 0 | 0 | — | part of the `test:ci` chain |
| `npm run test:integration` (real Redis) | 0 | **3** | 0 | **0** | ~2s | BullMQ round-trip **ran** — no skip |
| `npm run build` | **0** | n/a | 0 | n/a | 73–75s | Real production build against the licensed library |

Note: within `npm run test:ci` the BullMQ test still reports as skipped because that script does not set `REDIS_URL`. It is separately proven to pass against a real instance in the row above.

### Targeted coverage gates

| Suite | Exit | Passed | Failed | Skipped |
|---|---|---|---|---|
| `referenceScenarioCoverage.test.ts` | 0 | 6 | 0 | 0 |
| `criticalReferenceScenarios.integration.test.ts` | 0 | 10 | 0 | 0 |
| `referenceScenarios.integration.test.ts` | 0 | 7 | 0 | 0 |
| `doctrineGuard.test.ts` | 0 | 4 | 0 | 0 |
| `executionSourceEnforcement.test.ts` | 0 | 9 | 0 | 0 |

---

# MCP Results

| Command | Exit | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|---|
| `npm run typecheck` | 0 | n/a | 0 | 0 | clean |
| `npm run test:catalog` | 0 | 98 | 0 | 0 | 22 suites |
| `npm run schemas:check` | 0 | 57 tools OK | 0 | 0 | no drift; `contract:check` OK |

---

# Scenario Coverage

| Metric | Count |
|---|---|
| Registry scenarios (`REFERENCE_SCENARIOS`) | 30 |
| Covered scenarios (coverage map owners) | 30 |
| Uncovered scenarios | 0 |
| Critical integration scenarios | **20** (`CRITICAL_INTEGRATION_SCENARIOS`) |
| Coverage guard tests | 6 (all pass) |

Coverage map: `web/src/lib/agent/__tests__/fixtures/referenceScenarioCoverage.ts`
Guard: `web/src/lib/agent/__tests__/referenceScenarioCoverage.test.ts`

Fails when: missing owner, orphan owner, empty expected/forbidden, DB/lifecycle without integration, critical without integration, **or an owner naming a test that does not exist in its file**.

The last clause is new. The guard previously checked only that the owner's *file* existed, so a renamed, mistyped, or fabricated `testName` still passed — the coverage claim could drift from reality silently. All 30 owners were also read individually and confirmed to exercise real production modules with scenario-specific assertions, not registry-shape checks.

Earlier revisions of this document recorded **18** critical integration scenarios. The array has **20** entries; the count is corrected above.

---

# Human PR Review

A full review of `git diff origin/main...HEAD` was performed across decision authority, execution safety, database/migrations, concurrency, notifications, UI, security, and test quality. Findings and their resolution are recorded in the PR. Every Critical and High finding was fixed and is covered by a test:

| Severity | Finding | Fix |
|---|---|---|
| Critical | Crash between a revision write and cycle finalization dropped the notification, the broker SL/TP sync, and the audit record, then closed the claim as a false "stale/skipped" | `4a27fb9` — recognize and resume the interrupted cycle; idempotent |
| Critical | `executeIntent` skipped its lock entirely when `recommendation_id` was null, leaving the double-execution race open for standalone trades | `141a5dd` — unconditional per-intent lock |
| High | Deep opportunity scan sent a second, undeduped alert for a plan the lifecycle notifier had already announced | `c08ab40` — single announcer |
| High | Coverage guard accepted a `testName` that named no real test | `1ae2611` — verify the title exists |
| High | `corrupt_market_data` never exercised corrupt data (fixture self-neutralized; owning test seeded nothing) | `1ae2611` — real malformed bars, seeded, sanitizer asserted |

Medium/Low items fixed in the same pass: unisolated `alert_log` write (`29eb20a`), missing rate limit on the re-evaluation route (`29eb20a`), stale hard-coded `SCHEMA_VERSION` in the Postgres release gate (`29eb20a`), an unfalsifiable `errorCode` assertion and no-op "forbidden outcome" assertions (`1ae2611`), and an `AUTO_EXECUTION_STAGE` mutation without `try/finally` (`1ae2611`).

---

# Operationally Pending

These need a real external environment and are **not** blockers for code review or merge. None of them is claimed as verified above.

| Item | Status | Later command / action |
|---|---|---|
| PostgreSQL migration | Pending | Apply migrations on a safe copy; `npm run test:postgres-release` |
| pgvector | Pending | `CREATE EXTENSION vector`; confirm HNSW/ivfflat or the text fallback |
| MT5 / broker | Pending | Bridge + verified account |
| Telegram / Push / Service Worker | Pending | Credentials + delivery smoke in a real browser |
| SSL / reverse proxy / cron | Pending | Already provisioned in production; re-verify after deploy |
| dry-run / demo / live | Blocked | Keep `AUTO_EXECUTION_STAGE=off` until the gates in `LOCAL_AND_VPS_VALIDATION.md` pass |

---

# GitHub Actions (owner decision)

- Automatic `push` / `pull_request` triggers: **DISABLED**
- Workflow file retained: `.github/workflows/ci.yml`
- Trigger: `workflow_dispatch` only (manual)
- Job steps preserved (web lint/tsc/tests/build, MCP typecheck/catalog/schemas, Redis service for manual runs)
- Branch protection: if status checks still require Actions jobs, **owner must adjust GitHub Settings manually** — not a code defect

---

# TradingView licensed library

- Detected locally on the VPS and copied into the qualification worktree.
- Application paths: `web/public/charting_library/` (runtime) and `web/src/vendor/tradingview/` (typings).
- Confirmed ignored via `git check-ignore` against `web/.gitignore` lines 50–51; `git status` clean.
- **No licensed file is tracked, staged, or present in any commit.** `git ls-files` matches only our own integration code (the provisioning script, the API client, the bridge, a partner logo) — never the library.
