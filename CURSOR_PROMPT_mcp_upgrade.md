# AiChart MCP — upgrade brief

You are a senior TypeScript engineer working on the **AiChart MCP server** in `mcp/` of the AiChart repo (`github.com/loorksy/AiChart`, **private**). It is a live server behind `https://aichart.lork.cloud/mcp`, bridging Claude connectors to the platform's `/api/agent/*` and `/api/market/*` routes.

**This brief is grounded in the repo as it stands.** Read the "already built" section before planning anything — a generic MCP Apps tutorial will send you to rebuild infrastructure that exists.

---

## Already built — do not rebuild

| capability | where | state |
|---|---|---|
| MCP Apps wiring | `mcp/src/ui/index.ts` | `registerAppResource` + `createUIResource` + `_meta.ui.resourceUri` all in place |
| Widget authoring | `mcp/src/ui/widgets.ts` (930 lines) | `widgetHtml(title, html, js)` composes a widget from three strings |
| Widget runtime | `mcp/src/ui/runtime.ts` | the `AIC` helper object widgets receive — `fmt`, `onData`, `applyStaticLabels`, `parseAccountOverview` |
| Widget URIs | `mcp/src/ui/uris.ts` | the single source of truth for `ui://aichart/*`; tool `_meta` and `registerAppResource` must both read from here |
| Transport | `mcp/src/index.ts` | Streamable HTTP, single `/mcp` endpoint |
| OAuth 2.1 | `mcp/src/auth/` | dynamic client registration, `/register`, `/token`, `/.well-known/`, JWT, refresh store |
| Skills progressive disclosure | `mcp/src/skills/catalog.ts`, `select.ts` | list → rank → load, already three-step |
| Schema + contract parity | `mcp/scripts/export-schemas.mts`, `export-contract.mts` | `npm run schemas:check` fails the build on drift |

Dependencies already installed: `@modelcontextprotocol/ext-apps@^1.7.4`, `@mcp-ui/server@^6.1.0`, `@modelcontextprotocol/sdk@^1.29.0`, `zod@^4`, `express@^5`, `sharp`.

**Install nothing that is already here. Do not scaffold a second widget system beside `ui/`.**

---

## Current state, measured

- **53 tools** (`mcp/schemas/tools/*.json`)
- **2 widgets**: `account-overview`, `aichart` (`mcp/src/ui/uris.ts`)
- **0 occurrences** of `next_step`, `recovery_tool`, `adjustments`, `assistant_response`, `dry_run`, `job_id` anywhere in `mcp/src`

So: the UI *pipeline* is proven, the UI *coverage* is 2 of 53, and **server-driven steering does not exist at all**.

---

## Phase 0 — inventory, then stop

Produce `docs/tool-inventory.md` and stop for review. Write no implementation code first.

For each of the 53 tools: name, input schema, output shape, read or write, and which bucket:

- **A — consequential write** (commits real money, real orders, or irreversible state)
- **B — rich read** (structure a table/chart/panel presents far better than prose)
- **C — long-running** (can exceed ~2s)
- **D — plain read** (a scalar or short fact — stays text-only)
- **E — internal/meta** (discovery, config, health — stays text-only)

For every A and B tool, note what the user must **see** and **decide** at that moment.

Then catalogue every implicit convention a model must know to call these tools correctly. Some are already known and must appear in your inventory:

- **Broker symbols are case-sensitive.** The linked broker (Exness) spells `XAUUSDm`, `EURUSDm`, `AAPLm`. Uppercasing produces `Symbol XAUUSDM does not exist`. Platform-feed symbols are canonical uppercase. Two spellings, two pipes.
- **Two market-data pipes only**: `oanda` (platform feed) and `metaapi` (the trader's own cloud account). The EA bridge was removed — if you find any `ea` residue, it is a bug, not a third option.
- **`resolveMarketDataSource` never returns a pipe the account has not connected**, so a tool receiving a resolved source can trust it.
- **Spread differs materially per pipe** — 48 pips on the platform feed vs 24 on the trader's broker for the same instrument at the same moment. Any cost figure must say which book it came from.

Flag anything mid-migration or dead and ask before touching it.

---

## Phase 1 — steering fields across all 53 tools

**Do this first, before any new widget.** It is the largest quality gain, has zero UI dependency, and nothing in the repo has it yet.

### `next_step`

Return the exact next call, fully specified, so the model does not improvise:

```jsonc
{ "next_step": { "tool": "<name>", "reason": "<why this is correct now>", "params": { /* complete */ } } }
```

Map the real chains from your inventory and wire each hop.

### `recovery_tool`

On a recoverable failure, name the fix rather than returning a bare error:

```jsonc
{ "error": "<machine-readable code>", "recovery_tool": { "tool": "<name>", "call_immediately": true } }
```

Every failure mode gets a mapped recovery path or an explicit unrecoverable marker.

### `adjustments`

When the server clamps or coerces a caller value, say so, so the model reports it truthfully instead of claiming the requested value was used:

```jsonc
{ "adjustments": [ { "field": "<f>", "requested": <x>, "applied": <y>, "reason": "<constraint>" } ] }
```

### `assistant_response`

For consequential or compliance-sensitive results, a string the model relays **verbatim**. Say so in the tool description: *"Relay `assistant_response` verbatim; do not summarize."*

### Preflight

Every bucket-A tool takes `dry_run: true` returning the full computed consequence — sizing, exposure, cost, which constraint would bind — **committing nothing**. Add a test asserting nothing is written on a preflight call.

Add each field to the exported schemas and run `npm run schemas:check`.

---

## Phase 2 — widgets, extending the existing system

Build **one** end to end and stop for review before scaling.

Follow `mcp/src/ui/widgets.ts`: author with `widgetHtml(title, html, js)`, add the URI to `uris.ts`, register in `ui/index.ts`, reference it from the tool's `_meta.ui.resourceUri`. Widget JS receives `AIC` from `runtime.ts` — extend that object rather than importing anything into a widget.

### Resolve this before writing widget code

`mcp/src/ui/publicPath.ts` normalizes HTTP paths for widget assets, so widgets today are **served from our origin**, not inlined. A "fully self-contained, zero external requests" rule contradicts that, and chart images are delivered as URLs from our origin (`mcp/src/tools/imageDelivery.ts`).

**Pick one and state it in the PR:**
- keep origin-served assets and declare `_meta.ui.csp` for our origin only, or
- inline everything and change image delivery to embedded data.

Do not leave it implicit. Half-inlined widgets fail in some hosts and not others.

### Patterns

**A — decision card** (bucket A): every parameter and its consequence in the user's units; the constraint envelope read-only; a freshness/invalidation banner when the proposal was computed against state that has moved; distinct confirm / modify / cancel buttons. The widget calls tools through the host bridge (`app.callTool`), **never our REST API** — see the security rule below.

**B — live panel** (bucket B, time-varying): render from `structuredContent`, not a second fetch. **No synthetic, interpolated, or placeholder data ever.** A stale or unreachable upstream renders an explicit staleness banner with the age — never stale values styled as live, never a missing value as zero.

**C — report** (bucket B, analytical): verdict, then evidence, then raw numbers. Any score shows the inputs that produced it. Footer CTA advancing to the next tool, pre-filled.

**D — row-action table** (bucket B, collections): aggregate on top, per-row actions inline.

**E — status header**: connectivity and data freshness above any number.

Buckets D and E of the inventory stay text-only. **No widget for a tool that returns one number.**

### The text fallback is not optional

Every widget tool returns `structuredContent` **and** a `content` text block that conveys the result completely on its own. `mcp/src/bridge/textFallback.ts` exists for this. If the text alone does not let the user act correctly, the tool is not done.

---

## Phase 3 — async jobs

No bucket-C tool may block the transport.

1. Return `{ job_id, status: "queued" }` in under 500ms.
2. Add `jobs_wait(job_ids: string[])` — long-poll up to 12, return when all terminal.
3. Add `show_jobs_by_ids(...)` — render the whole completed set in **one** widget call.
4. Never call a per-job display tool in a loop.

---

## Phase 4 — tool descriptions

Rewrite all 53 to one standard. Each states:

1. What it does, one sentence, in user-facing terms — no internal table or column names.
2. When to call it **and when not to**.
3. Its defaults, so the model never guesses a parameter.
4. Every implicit convention from Phase 0 — spelled out, especially symbol case and which pipe a figure came from.
5. If it can return `next_step`: *"If `next_step` is returned, call it immediately without asking the user."*

---

## Security — non-negotiable

- **A widget must never call `/api/agent/*` directly.** Those routes authenticate with a service token plus a signed `X-Aichart-User-Email` header that a browser cannot produce; every such call returns `توكن الوكيل غير صحيح`. This was a real production bug. Widgets go through `app.callTool`, always.
- Never put credentials, account identifiers, tokens, or session secrets in `structuredContent` — the host sees that payload.
- A widget may **propose** a consequential action; only a server-side tool call with a valid token executes one.
- Server-enforced limits stay read-only to both agent and widget.
- Declare `_meta.ui.csp` only for origins you actually decided on above.

---

## Repo conventions

- **`npm run schemas:check` must pass.** `mcp/schemas/tools/*.json` and `mcp/contracts/tools.json` are **generated**. Edit a schema, regenerate, commit both. Treat them as outputs, never sources.
- **Tests**: `npm run test:catalog` (contract parity, widget tests, skills, i18n). Add to it, do not replace it.
- **Typecheck**: `npm run typecheck` in `mcp/`, and `npx tsc --noEmit` in `web/` if you touch a shared route.
- **The web suite** (`web/`: `npm run test:unit`) must stay green — currently **977/977, zero failures**. Any failure is yours.
- **CRLF line endings.** Script-based find/replace silently no-ops on `\n` anchors. Use editor edit tools or line-aware scripts.
- **New npm dependency** → regenerate `package-lock.json` **on the Linux VPS**, copy back, commit. A Windows-generated lockfile omits `@emnapi/*` and 502s production. This has happened twice.
- Repo stays private.

---

## Verification

Local:

```bash
cd mcp && npm run typecheck && npm run schemas:check && npm run test:catalog
cd ../web && npx tsc --noEmit && npm run build && npm run test:unit
```

Then render every widget in a real host — the local example host and Claude via the remote connector. A widget that only renders in one is not done.

**A green build is not evidence.** Four defects in this repo last week passed a clean `tsc`, a clean build, and a green suite, and were caught only by exercising the deployed system:

| defect | why the build could not see it |
|---|---|
| SDK root import resolved to a browser bundle → `window is not defined` | an export map is runtime resolution, not a type |
| `XAUUSDm` uppercased → "Symbol does not exist" | broker symbols are case-sensitive |
| billing lived inside a code path that was removed | no type expresses "this meter still runs" |
| `state` compared against the wrong object's spelling | same word, two objects |

Deploy is a separate, explicit step — do not run it unless asked:

```bash
ssh 72.60.83.140 'cd /opt/aichart && git fetch origin main && git reset --hard origin/main \
  && rm -rf web/.next && cd web && npm run build \
  && pm2 restart aichart-web aichart-mcp aichart-worker'
```

---

## Acceptance

- [ ] `docs/tool-inventory.md` complete; every widget traces to an A/B/C entry
- [ ] All 53 tools return `next_step` where a next step exists, and `recovery_tool` on every recoverable failure
- [ ] Every bucket-A tool has `dry_run` returning full consequence figures and committing nothing — asserted by test
- [ ] Every widget tool's text fallback conveys the result without the UI
- [ ] The highest-value consequential action completes with zero typing
- [ ] Every bucket-C tool returns `job_id` in under 500ms
- [ ] Degraded upstreams render as explicit banners — never zeros, never stale-styled-live
- [ ] No synthetic or placeholder data path anywhere
- [ ] `schemas:check`, `test:catalog`, and the web suite all pass
- [ ] The origin-served vs inlined decision is stated in the PR

## Order

1. **Phase 0 inventory — stop for review.**
2. Phase 1 steering across all tools. No UI dependency, immediate gain.
3. One widget end to end — stop for review.
4. Remaining widgets.
5. Phase 3 async jobs.
6. Phase 4 descriptions.

Commit per phase, do not batch. Commit messages and comments explain **why**, not what; match the surrounding code's density and idiom.
