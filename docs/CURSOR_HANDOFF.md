# Handoff — Unified Agent PR #82

## Last SHA

`29eb20a` — clean qualification on Node 22 + human PR review fixes, on top of `ad38243`.

Branch: `claude/aichart-agent-development-plan-mflw6l`
PR: https://github.com/loorksy/AiChart/pull/82 — **open, Ready for Review, not merged**
`AUTO_EXECUTION_STAGE=off`

## State

The local verification matrix is the official merge gate. It is now **fully green**, including the three checks previous windows could not run:

| Check | Result |
|---|---|
| Clean `npm ci` (web + mcp) on Node 22 | PASS |
| `npm run lint` | PASS — 0 errors |
| `npx tsc --noEmit` | PASS — Exit 0, clean |
| `npm run test:ci` | PASS — 823 + 79 |
| `npm run test:integration` with real Redis | PASS — 3/3, **no skip** |
| `npm run build` with the licensed library | PASS — Exit 0 |
| MCP typecheck / catalog / schemas | PASS — 98/98, 57 tools |

Details and the exact environment: `docs/LOCAL_RELEASE_QUALIFICATION.md`.

Qualification ran on the **VPS** in a detached worktree at `/root/aichart-qualification-996dcb`, isolated from `/opt/aichart` and from the live pm2 services. That is where Node 22, Docker, and the licensed TradingView library already exist. The Windows workstation has none of the three, which is why earlier windows recorded them as pending.

## GitHub Actions

Automatic execution is **intentionally disabled by owner decision** and is **not** a merge gate. `.github/workflows/ci.yml` is `workflow_dispatch` only, with all job steps preserved for manual runs. Do not re-enable the `push` / `pull_request` triggers, and do not treat red or absent PR checks as a code defect. If branch protection still requires Actions status checks, the owner adjusts that in GitHub Settings → Branches by hand.

## Completed in the last window

Human review of the full `origin/main...HEAD` diff across decision authority, execution safety, database, concurrency, notifications, UI, security, and test quality. Two Critical and three High findings were fixed, each with a test:

- `141a5dd` — `executeIntent` skipped its lock entirely when `recommendation_id` was null, leaving the double-execution race open for standalone trades.
- `4a27fb9` — a crash between a revision write and cycle finalization dropped the notification, the broker SL/TP sync, and the audit record, then closed the claim as a false "stale".
- `c08ab40` — the deep opportunity scan sent a second, undeduped alert for a plan already announced.
- `1ae2611` — the coverage guard accepted a `testName` naming no real test, and `corrupt_market_data` never exercised corrupt data.
- `29eb20a` — unisolated `alert_log` write, missing rate limit on the re-evaluation route, stale hard-coded `SCHEMA_VERSION` in the Postgres gate.

## Remaining

### Programming

None known. No `missing` or `partial` items remain in the plan's programmatic scope.

### Operational-only — needs a real environment

See `docs/LOCAL_AND_VPS_VALIDATION.md` for the per-item gate table.

- Postgres migration on a safe copy, then `npm run test:postgres-release`.
- `CREATE EXTENSION vector` + HNSW/ivfflat, or confirm the JS fallback in prod.
- MT5 / broker demo, live quotes.
- Telegram, Push, Service Worker delivery in a real browser.
- Disconnect/reconnect: auto must drop to advisory and must not self-restore.
- `dry_run` → `demo` → `live`: owner promotes one step at a time. Never skip a step.

## Key paths

- `web/src/lib/execution.ts`
- `web/src/lib/recommendations/reevaluationCycle.ts`
- `web/src/lib/opportunityScan.ts`
- `web/src/lib/agent/__tests__/fixtures/referenceScenarioCoverage.ts`
- `web/src/lib/agent/__tests__/referenceScenarioCoverage.test.ts`
- `docs/LOCAL_RELEASE_QUALIFICATION.md`
- `docs/UNIFIED_AGENT_COMPLETION_AUDIT.md`
- `docs/LOCAL_AND_VPS_VALIDATION.md`

## Failed tests

None.

## Reproducing the qualification

The licensed TradingView library is gitignored and exists only locally and on the VPS. A fresh worktree will not have it — copy it in before typecheck or build:

```bash
cd /opt/aichart && git worktree add --detach /root/aichart-qual <SHA>
cp -r /opt/aichart/web/public/charting_library /root/aichart-qual/web/public/charting_library
cp -r /opt/aichart/web/src/vendor/tradingview /root/aichart-qual/web/src/vendor/tradingview
cd /root/aichart-qual/web && npm ci --no-audit --no-fund
npm run lint && npx tsc --noEmit && npm run test:ci && npm run build
```

Never commit the library, and never substitute a stub for it.
