# Cursor Handoff — Unified Agent PR #82

## Last SHA

Will be updated after push. Base of this window: `7bed487` (`feat: materialize platform MCP decision parity`).

Worktree (do not use main checkout — branch is locked there):

`C:\Users\ALALMIA\Documents\GitHub\AiChart\.claude\worktrees\aichart-agent-updates-test-b3e068`

Branch: `claude/aichart-agent-development-plan-mflw6l`  
PR: https://github.com/loorksy/AiChart/pull/82 (Draft)  
`AUTO_EXECUTION_STAGE=off`

## Completed in this window

1. **CI root cause** — GitHub account billing lock; jobs never start (not code).
2. **`opportunity_created` unified** — orchestrator + `saveRecommendation` + chart adapter → `announceOpportunityCreated` only; guard against parallel `claimLifecycleDedupeKey`.
3. **Canonical adherence** — price late-entry (relative/ATR), exit kinds, delayed-entry threshold, summary counts; UI reads server summary.
4. **Reference scenario pack** — 30 §16 scenarios + images/costs/calendar fixtures + integration suite.
5. **Audit + ops docs** — `UNIFIED_AGENT_COMPLETION_AUDIT.md`, `LOCAL_AND_VPS_VALIDATION.md`.

## Remaining

### Programming

- Optional: extend `referenceScenarios.integration.test.ts` so every one of the 30 IDs has a dedicated pipeline assertion (registry + clear_trend + MCP dedupe + image/cost/calendar already green).
- Optional: fold chart-photo delivery into lifecycle payload (today flag-ON creation is text lifecycle only).

### Operational-only

- Unlock GitHub billing → re-run CI.
- Set TradingView secrets for Build step.
- VPS: Postgres migrate, vector extension, Redis, EA, Telegram, Push, SSL/cron.
- Never enable live auto without owner ladder.

## Open files / key paths

- `web/src/lib/store.ts`
- `web/src/lib/recommendationChart.ts`
- `web/src/lib/recommendations/canonical/analytics.ts`
- `web/src/lib/recommendations/performanceJournal.ts`
- `web/src/lib/agent/__tests__/fixtures/referenceScenarioPack.ts`
- `web/src/lib/agent/__tests__/referenceScenarios.integration.test.ts`
- `docs/UNIFIED_AGENT_COMPLETION_AUDIT.md`
- `docs/LOCAL_AND_VPS_VALIDATION.md`

## Failed tests

None in the suites run this window (opportunity / adherence / journal / singleBrainGuard / referenceScenarios).

## First step next session

1. `cd` into the worktree above.
2. `git status -sb && git log -3 --oneline`
3. Unlock GitHub billing if possible; `gh pr checks 82`
4. `cd web && npm run test:ci` then `cd ../mcp && npm run typecheck && npm run test:catalog && npm run schemas:check`
5. Keep PR Draft until CI green (or billing blocker still documented).

## Resume commands

```bash
cd "C:/Users/ALALMIA/Documents/GitHub/AiChart/.claude/worktrees/aichart-agent-updates-test-b3e068"
git status -sb
cd web && npm run test:ci
cd ../mcp && npm run typecheck && npm run test:catalog && npm run schemas:check
gh pr checks 82
```
