# Manual VPS Release Qualification — PR #66

**Decision:** `NO-GO — MANUAL RELEASE GATE FAILED`

**CI bypass:** Authorized for GitHub-hosted Actions only (billing lock; jobs fail before any steps). GitHub check records were not altered or faked.

| Item | Value |
|---|---|
| Repository | `loorksy/AiChart` |
| PR | [#66](https://github.com/loorksy/AiChart/pull/66) |
| Branch | `fix/candidate-free-model-authority` |
| Primary tested PR head | `2a06170be0e4870d664adabfc12205221433c08c` |
| Base / rollback | `d995fdf52ab2983bc116407999777048ee9396e8` |
| VPS host | `srv1150752` (`72.60.83.140`) — identifier only |
| RC directory | `/opt/aichart-rc-pr66-2a06170` (isolated; not production `/opt/aichart`) |
| Node / npm | `v22.22.2` / `10.9.7` |
| OS | Ubuntu Linux 6.8.0-134-generic x86_64 |
| Start (UTC) | `2026-07-18T22:31:30Z` |
| Production commit (verified) | `d995fdf…` via `/api/healthz` |

## Why GitHub CI was bypassed

Web checks and MCP checks complete in ~2–4 seconds with **empty step lists**. Account/repository billing lock prevents runner execution. No CI suite ran. Equivalent or stronger gates were attempted manually on an isolated VPS release candidate.

## Isolated environment

| Resource | Isolation |
|---|---|
| Git worktree | Clean clone at RC dir; `git status --porcelain` empty; HEAD = tested SHA |
| TradingView | Copied from production licensed dirs (not from git) |
| PostgreSQL | `aichart_rel_pr66` (name matches `aichart_rel*` refuse rule) |
| Redis | Docker `aichart-redis-rel` on `127.0.0.1:6380` with auth + AOF |
| Port | RC env `PORT=3019` (production remains 3010) |
| Live orders | `AICHART_DISABLE_LIVE_ORDERS=1` |
| Production | Untouched (`/opt/aichart` still `d995fdf`) |

## Gate table

| Gate | Command / method | Environment | Commit | Passed | Failed | Skipped | Evidence |
|---|---|---|---|---|---|---|---|
| Source SHA | `git rev-parse HEAD` | RC | `2a06170` | 1 | 0 | 0 | matches expected |
| Clean tree | `git status --porcelain` | RC | `2a06170` | 1 | 0 | 0 | empty |
| Architecture absence | banned-token scan | RC | `2a06170` | 1 | 0 | 0 | no Trade Candidate engine tokens |
| `git diff --check` | vs `origin/main` | RC | `2a06170` | 0 | 1* | 0 | docs trailing whitespace only (*fixed in follow-up) |
| web `npm ci` | lockfile install | RC | `2a06170` | 1 | 0 | 0 | `/tmp/pr66-rc-gates.log` |
| mcp `npm ci` | lockfile install | RC | `2a06170` | 1 | 0 | 0 | same |
| MCP `schemas:check` | npm script | RC | `2a06170` | 1 | 0 | 0 | OK |
| MCP `typecheck` | npm script | RC | `2a06170` | 1 | 0 | 0 | OK |
| MCP `test:catalog` | npm script | RC | `2a06170` | 1 | 0 | 0 | 70/70 |
| Web `tsc --noEmit` | npx tsc | RC | `2a06170` | 1 | 0 | 0 | OK |
| Lint changed first-party | eslint existing changed files | RC | `2a06170` | 0 | 1 | 0 | 1× `prefer-const` in recommendation route |
| Lint full (honest) | `npm run lint` | RC | `2a06170` | 0 | 1 | 0 | 24 errors / 155 warnings (vendor/baseline; not claimed green) |
| Web production build | `npm run build` + TV assets | RC | `2a06170` | 1 | 0 | 0 | clean provisioned build OK |
| MCP build | `npm run build` | RC | `2a06170` | 1 | 0 | 0 | OK |
| `npm run test:ci` | full matrix + Redis 6380 + PG | RC | `2a06170` | 1 | 0 | 0 | PASS after isolation fix; BullMQ round-trip **not** skipped |
| Redis release | `npm run test:redis-release` | Redis `:6380` auth+AOF | `2a06170` | 1 | 0 | 0 | auth, persistence, queue, idempotency OK |
| PostgreSQL release | `npm run test:postgres-release` | `aichart_rel_pr66` | `2a06170` | 0 | 1 | 0 | column contract lag: `preferred_model` / `preferred_reasoning_effort` |
| Provider release | `npm run test:provider-release` | RC env | `2a06170` | 0 | 1 | 0 | `openai_not_configured`; `ea_probe_user_not_configured`; OANDA passed |
| Model-first suite | `test:model-first` | RC | `2a06170` | 1 | 0 | 0 | 54/54 including drawings + persistence mapper |
| Authenticated MCP live | `MCP_TEST_EMAIL` suite | — | — | 0 | 0 | 1 | **NOT RUN** — no `MCP_TEST_EMAIL` / OpenAI on VPS |
| Browser qualification | authenticated multi-viewport | — | — | 0 | 0 | 1 | **NOT RUN** — blocked; no OpenAI; no RC preview server completed |
| Provider non-executing model smoke | OpenAI Responses/Vision | — | — | 0 | 0 | 1 | **NOT RUN** — `OPENAI_API_KEY` absent from VPS env/PM2 |
| Historical Candidate row (DB adapter) | real PG row through adapters | — | — | 0 | 0 | 1 | mapper unit test only; full adapter path **NOT VERIFIED** |
| Secret scan (gitleaks) | — | — | — | 0 | 0 | 1 | gitleaks unavailable |
| Secret scan (redacted patterns) | custom | RC | `2a06170` | 0 | 1 | 0 | noisy false positives on keywords; tracked `.env` absent |
| Tracked secrets | `git ls-files` | RC | `2a06170` | 1 | 0 | 0 | no `.env`/`.cursor`/db tracked |

\* Docs trailing whitespace and `prefer-const` / postgres validator drift are being corrected in a follow-up commit; that **changes the release SHA** and requires full re-qualification.

## Blocking defects (Critical / High)

1. **Critical — OpenAI not configured on VPS** (`OPENAI_API_KEY` missing from production and RC `.env` and PM2). Blocks provider release, model Vision smoke, and meaningful browser BUY/SELL/WAIT qualification.
2. **Critical — Authenticated MCP not run** (`MCP_TEST_EMAIL` unset).
3. **High — Browser qualification not run** (depends on RC preview + model + auth).
4. **High — First-party lint error** on changed files (`prefer-const` in `create_recommendation` route) at tested head.
5. **High — PostgreSQL release validator failed** on settings column contract (schema has model-preference columns validator did not expect).
6. **High — Historical Candidate-backed row** not exercised through real persistence/rendering adapters (unit mapper only).
7. **High — EA probe user not configured** for execution-safety provider probe.

## Explicitly not done

- Merge of PR #66
- Production deployment
- Production DB/Redis mutation
- Live trade execution
- Faking GitHub CI statuses

## Rollback readiness

| Item | Status |
|---|---|
| Rollback target | `d995fdf52ab2983bc116407999777048ee9396e8` |
| Production still on rollback target | **Yes** (verified) |
| RC can be removed | `rm -rf /opt/aichart-rc-pr66-2a06170`; `docker rm -f aichart-redis-rel`; `dropdb aichart_rel_pr66` (isolated only) |

## Final decision

`NO-GO — MANUAL RELEASE GATE FAILED`

GitHub CI bypass does **not** authorize merge/deploy. Mandatory VPS gates remain incomplete or failing.
