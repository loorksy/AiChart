---
name: land-and-deploy
version: 1.0.0
description: Merge-to-main VPS deploy for AiChart/Lonora — build web + MCP, PM2, three verification circles, and logged-in verification prerequisites.
category: operations
riskLevel: production
tags: ["deploy", "vps", "pm2", "verification", "production"]
---

# Land and deploy (VPS)

Use this skill when the owner asks to **merge, deploy, or verify production** after code is on `main`.

## Standing prerequisites (before you claim a full verification pass)

### 1. Code and build gates

- Exact pushed commit on `origin/main` (record full SHA and `git rev-parse HEAD^{tree}`).
- Local Release Qualification green where applicable (`docs/LOCAL_RELEASE_QUALIFICATION.md`).
- Licensed TradingView library present on the VPS worktree (`web/public/charting_library/`, `web/src/vendor/tradingview/`).
- Production secrets present (`docs/LOCAL_AND_VPS_VALIDATION.md`, `docs/PRODUCTION_OPERATIONS.md`) — never log `.env` contents.

### 2. Production verification account (mandatory for logged-in checks)

**Nine post-deploy verification items require an authenticated platform session** (console routes, logged-in chart behaviour, favourites/catalogue as the seeded user, mobile top-bar scroll at 375px, and similar). They are **BLOCKED** until this prerequisite is met.

| Rule | Detail |
|------|--------|
| Owner action | The owner must provision (or confirm) a **production login** that works on the live site — password and/or Google as configured on the box. |
| Designated identity | **`looorksy@gmail.com`** is the verification account for this project; confirm the user id and seeded data on production before asserting catalogue/favourites claims. |
| Secrets | **Never** commit passwords or paste them into the repo, skills, or PRs. Credentials live in the owner’s secret store or VPS `web/.env` only if the owner adds them there. |
| Do not workaround | Do **not** fake logged-in verification with MCP service tokens, bridge-only routes, hand-crafted cookies, or admin impersonation unless the verification matrix explicitly allows it (it does not for these nine items). |
| Agent behaviour | If login fails, report **BLOCKED (verification account)** and continue with every check that does not require a session. Do not spin alternate accounts or weaken auth. |

Until production login succeeds for the verification account, mark those nine items **BLOCKED**, not PARTIAL and not NOT DONE.

## Standard VPS procedure (`/opt/aichart`)

1. `git fetch origin main && git reset --hard origin/main` — target SHA must match the merge commit you are deploying.
2. **Stop** all three AiChart PM2 apps before build (`aichart-web`, `aichart-worker`, `aichart-mcp`) to avoid DB lock / slow SSG during `next build`.
3. `cd web && rm -rf .next && npm ci && npm run build`
4. `cd mcp && npm ci && npm run build`
5. Set `GIT_COMMIT=$(git rev-parse HEAD)` in `web/.env` (PM2 env can override — export on restart).
6. `cd /opt/aichart && GIT_COMMIT=<sha> pm2 start infra/pm2.ecosystem.config.cjs` (or delete + start all three) && `pm2 save`
7. Run the **three verification circles** below.

Other PM2 apps on the host (e.g. unrelated bots) must **not** be restarted.

## Three verification circles

### Circle 1 — Local (or CI agent workspace)

- `git rev-parse HEAD` and `git rev-parse HEAD^{tree}`
- `cd web && npm run test:unit` (and any merge-gate suites the owner requested)
- Optional: count API handlers — `find web/src/app/api -name route.ts | wc -l` (record the number; drift means a route was added or removed intentionally)

### Circle 2 — VPS tree match

On the box after `reset --hard`:

- `REMOTE_SHA` equals deployed commit
- `REMOTE_TREE` equals local `HEAD^{tree}` from circle 1

### Circle 3 — Production probes (unsigned / health)

Minimum set (extend when the owner attached a claim table):

- `curl -fsS http://127.0.0.1:3010/api/healthz` — `commit` matches deployed SHA
- `curl -fsS http://127.0.0.1:8787/health` — MCP `commit` matches
- Confirm removed routes are absent from source tree and return **404** when probed (e.g. orphaned write endpoints)
- Grep built `.next` for forbidden chart-trading UI strings when the product decision forbids them
- Public smoke: `/`, `/chart`, `/docs` as appropriate (200 where expected)

Report circle 3 output verbatim in the handoff (SHA, tree hash, route count, key HTTP codes).

## Logged-in verification (after prerequisite §2)

Only after a successful production login as the verification account:

- Run the nine session-dependent checks from the owner’s verification matrix.
- Do not mark them DONE on guest/anonymous probes alone.

## Related docs

- `docs/PRODUCTION_OPERATIONS.md` — release preflight, `GIT_COMMIT`, fail-closed flags
- `docs/LOCAL_AND_VPS_VALIDATION.md` — what blocks VPS deploy vs execution stages
- `CI_AND_DEPLOYMENT.md` — test commands and TradingView provisioning
