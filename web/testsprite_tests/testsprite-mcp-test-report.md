# TestSprite AI Testing Report — AiChart

---

## 1️⃣ Document Metadata

| Field | Value |
|-------|-------|
| **Project Name** | web (AiChart) |
| **Project Path** | `C:\Users\ALALMIA\Documents\GitHub\AiChart\web` |
| **Date** | 2026-06-09 |
| **Test Type** | Backend API (cloud execution against localhost tunnel) |
| **Server Mode** | development (`npm run dev` on port 3000) |
| **Prepared by** | TestSprite AI + Cursor Agent |
| **Dashboard** | [TestSprite MCP Tests](https://www.testsprite.com/dashboard/mcp/tests/edbc1990-292c-4bbc-bbd7-1bb5e3b89fbf) |

---

## 2️⃣ Requirement Validation Summary

### REQ-1: Authentication

| Test | Status | Finding |
|------|--------|---------|
| TC001 Login valid credentials | ✅ Passed | Login, `/chat`, `/dashboard`, `/signals/new` load with session cookie |
| TC002 Login invalid credentials | ❌ Failed | Login returns 401 correctly, but `/api/me` returns **200 + `{user:null}`** instead of 401 when unauthenticated |
| TC003 Logout clears session | ✅ Passed | Logout works; protected pages blocked after logout |

**TC002 root cause:** [`/api/me`](web/src/app/api/me/route.ts) uses soft-null response (`200`) rather than `401` for anonymous callers. Tests expecting strict auth semantics fail.

---

### REQ-2: AI Chat Agent

| Test | Status | Finding |
|------|--------|---------|
| TC004 GET `/api/chat/status` | ✅ Passed | Returns `{ ready: true, model: "claude-opus-4-8" }` |
| TC005 POST `/api/chat` streaming | ✅ Passed | SSE events `delta`, `activity`, `done` all received |
| TC006 POST `/api/chat` unauthenticated | ✅ Passed | Returns 401/403 as expected |

---

### REQ-3: Conversations API

| Test | Status | Finding |
|------|--------|---------|
| TC007 POST `/api/conversations` | ❌ Failed | API returns `{ conversation: { id, ... } }` but test expected flat `{ id }` |
| TC008 GET `/api/conversations` | ❌ Failed | API returns `{ conversations: [...] }` but test expected raw array |
| TC009 GET `/api/conversations/{id}` | ❌ Failed | Test used Bearer token + wrong credentials; app uses **cookie session**, not JWT in body |

**Root cause:** Response shape mismatch between implementation and TestSprite-generated expectations. Not necessarily application bugs — document API contract or align responses.

---

### REQ-4: Signals Wizard

| Test | Status | Finding |
|------|--------|---------|
| TC010 POST `/api/signals/generate` | ❌ Failed | Test called `/api/instruments?search=USDT` and expected array; API uses `?q=` and returns `{ instruments, total }` |

**Root cause:** Query param name (`q` vs `search`) and wrapped response format.

---

## 3️⃣ Coverage & Matching Metrics

| Requirement | Total Tests | ✅ Passed | ❌ Failed | Pass Rate |
|-------------|-------------|-----------|-----------|-----------|
| Authentication | 3 | 2 | 1 | 67% |
| AI Chat Agent | 3 | 3 | 0 | 100% |
| Conversations | 3 | 0 | 3 | 0% |
| Signals Wizard | 1 | 0 | 1 | 0% |
| **Overall** | **10** | **5** | **5** | **50%** |

### What passed (core flows work)

- Admin login + page access (chat, dashboard, signals wizard)
- Chat agent status + streaming SSE
- Chat auth guard
- Logout flow

### Generated test artifacts

- `web/testsprite_tests/TC001_*.py` … `TC010_*.py`
- `web/testsprite_tests/testsprite_backend_test_plan.json`
- `web/testsprite_tests/testsprite_frontend_test_plan.json` (not executed this run)

---

## 4️⃣ Key Gaps / Risks

### High priority (real issues)

1. **`/api/me` anonymous access** — Returns HTTP 200 with `user: null`. Clients/tests cannot distinguish “logged out” from “logged in” by status code alone. Consider returning `401` for unauthenticated API calls.

### Medium priority (contract / test mismatch)

2. **Conversations API shape** — Wrapped objects (`{ conversations }`, `{ conversation }`) differ from REST conventions TestSprite assumed. Either update OpenAPI/docs or add compatibility aliases.

3. **Instruments API** — Uses `?q=` not `?search=`; returns `{ instruments, total }`. Frontend and external tests should use documented params.

4. **Auth model** — Cookie-based JWT sessions, not `Authorization: Bearer` in login JSON. Document for integrators and TestSprite re-runs.

### Low priority

5. **Frontend UI tests** — Only backend plan executed. Run `testsprite_frontend_test_plan.json` separately for RTL mobile UI coverage.

6. **Production mode** — Dev server limits TestSprite to priority tests. For full suite: `npm run build && npm run start` then re-run with `serverMode: production`.

### Recommended fixes before VPS deploy

| Fix | Effort | Impact |
|-----|--------|--------|
| Return 401 on `/api/me` when no session | Small | Security clarity |
| Document API response schemas | Small | Test/integration stability |
| Re-run TestSprite after fixes | Medium | Higher pass rate |

---

*Report generated from `testsprite_tests/tmp/raw_report.md` and `test_results.json`.*
