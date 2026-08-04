# Phase 1 approved — fix two things, then run Phases 2→4 straight through

I verified your Phase 1 against the branch rather than taking the report at face value. The three properties that mattered all hold:

- **`dry_run` writes nothing.** The idempotency read guard plus `dry_run ? null : idempotencyKey` at all four write sites. Your catch there was the right one — without it a real call reusing the key would have replayed a stale preview instead of executing.
- **`next_step` cannot steer into execution.** All ten destinations are `get_*` reads; not one of the seven bucket-A tools appears in the table. The comment "the table has no entry and `next_step` is simply absent — never fabricated" is the discipline I wanted.
- **You refused to fabricate a preview.** Three distinct `no_position_lookup` reasons, each naming the exact missing capability and confirming nothing reaches the broker. Saying what you could not compute was worth more than a plausible number.

Also good: turning the symbol canonicalization into *"never tell the operator the requested spelling was queried verbatim."* That is a real bug class converted into an enforced honesty rule.

---

## Fix these two before anything else

**1. `npm run schemas:check` does not pass.** It runs two checks. The first is fine; the second reports:

```
schemas:check OK (53 tools)
contract.json drift — run npm run contract:export
```

You edited schemas after the last contract export. Regenerate and commit. `mcp/schemas/tools/*.json` and `mcp/contracts/tools.json` are **outputs, never sources** — after any schema edit, regenerate both, in the same commit.

**2. The test numbers do not match.** You reported `993/993, zero failures`. On your branch I measure **1003 tests, 1000 pass, 3 fail** — the Redis release-validator trio, which **passed on `main` after the EA removal (977/977)**. Your branch is based on current `main` with zero commits missing, so the comparison is fair.

Re-run clean and report the number as it comes. If something in your changes re-broke that script, you find that by running it, not by assuming. Do not delete or skip those tests to reach a green number.

---

## Then run Phases 2, 3 and 4 in order, in one pass

No more stopping between phases. Commit per phase, keep the order, run the full verification at the end.

### Phase 2 — widgets

Build the first widget end to end, prove the pattern, then apply it to the rest of your bucket A/B list.

**Read the official spec and API against `mcp/src/ui/` before writing widget code:**

- **https://github.com/modelcontextprotocol/ext-apps** — read `specification/2026-01-26/apps.mdx`, and the `examples/`: `cohort-heatmap-server` and `scenario-modeler-server` for data-dense cards, `system-monitor-server` for a live-updating panel.
- **https://apps.extensions.modelcontextprotocol.io/api/** — the API reference.

The wiring (`registerAppResource`, `createUIResource`, `_meta.ui.resourceUri`) already exists. Use the docs to learn what the host guarantees and what the current API offers that our hand-rolled `widgetHtml` / `runtime.ts` predates. **Where they disagree with what is in the repo, say so in the PR — do not quietly fork a second widget system beside `ui/`.**

**The button guard — decided:** narrow it, do not delete it.

- Allowed from a card: `request_approval`, `respond_approval`, `get_pending_approvals`
- Forbidden from a card, asserted by test: `open_trade`, `close_trade`, `close_partial`, `modify_sl_tp`, `cancel_mt5_order`, and any future execution tool

A card is an **approval surface, never an execution surface**. Rewrite `cardButtons.test.ts` to assert that distinction and put the reasoning in its comment, so nobody has to excavate git history again. Approve/reject buttons and new cards are both approved.

**Do not pick `scan_market` or `detect_levels` as the first widget** — you flagged both as possible shape mismatches. Build on a sound pairing first, then fix those two as separate work in the same PR.

Patterns, applied to whatever your inventory bucketed:

- **Decision card** (bucket A): every parameter and its consequence in the operator's own units; the constraint envelope read-only; a prominent invalidation banner when the proposal was computed against state that has since moved; distinct approve / reject / modify buttons calling the approval tools through `app.callTool`.
- **Live panel** (bucket B, time-varying): render from `structuredContent`, never a second fetch. **No synthetic, interpolated or placeholder data anywhere.** A stale or unreachable upstream renders an explicit staleness banner with the age — never stale values styled as live, never a missing value as a zero.
- **Report** (bucket B, analytical): verdict, then evidence, then raw numbers. Any score shows the inputs that produced it. Footer CTA advancing to the next tool, pre-filled.
- **Row-action table** (bucket B, collections): aggregate on top, per-row actions inline.
- **Status header**: connectivity and data freshness above any number.

Buckets D and E stay text-only. **No widget for a tool that returns one number.**

**Every widget tool still returns a text fallback that conveys the result completely on its own.** If the text alone does not let the operator act correctly, the tool is not done.

**Resolve and state the asset decision:** `mcp/src/ui/publicPath.ts` implies widgets are served from our origin, and chart images are delivered as URLs (`mcp/src/tools/imageDelivery.ts`). Either keep origin-served assets and declare `_meta.ui.csp` for our origin only, or inline everything and embed image data. Pick one, say which in the PR. Half-inlined widgets work in one host and fail in another.

### Phase 3 — async jobs

No bucket-C tool may block the transport.

1. Return `{ job_id, status: "queued" }` in under 500ms.
2. `jobs_wait(jobs)` — long-poll 1–12 together, return when all terminal, expose `all_terminal` and `poll_after_seconds`.
3. `show_jobs_by_ids(...)` — render the whole completed set in **one** widget call.
4. **Never call a per-job display tool in a loop**, and say so in the tool descriptions.

### Phase 4 — tool descriptions, all 53

Each states: what it does in one sentence in operator-facing terms; when to call it **and when not to**; its defaults so the model never guesses; every implicit convention from your Phase 0 inventory — especially broker symbol case-sensitivity and which pipe a figure came from; and, where applicable, *"If `next_step` is returned, call it immediately without asking the user."*

**The standard is the live Higgsfield `generate_image` description.** Match this level literally — every one of these is in their text:

| pattern | their wording |
|---|---|
| preflight | `get_cost:true` — *"return the cost in credits **without submitting any job**"* |
| adjustments | *"count is capped to 1 and **the cap comes back in `adjustments`**"* |
| recovery | *"If `recovery_tool` returned, **call it immediately; do not explain/ask first**"* — plus a named recovery per error code |
| async | `jobs_wait` — 1–12 jobs, `all_terminal`, `poll_after_seconds` |
| no display loops | *"display them with **one** call. **Never** call `job_display` once per batch job"* |
| honesty | *"**Never quietly re-run the same request on credits — say what happened first**"* |
| defaults | *"Defaults: `marketing_studio_image` for commercial/product/ads; `soul_cast` for text-only character…"* |
| conventions | *"`medias[].value` must be media_id/job_id, **not URL**"* |
| when not to | *"do not ask for Claude chat attachments **because remote tools cannot read them**"* |

Note that the widget is **one clause** in that whole description. The reliability comes from the contract text, not the UI.

---

## Constraints — unchanged

- `npm run typecheck`, `npm run schemas:check` (**both** halves), `npm run test:catalog` pass in `mcp/`.
- `npx tsc --noEmit`, `npm run build`, `npm run test:unit` pass in `web/`. Report the real numbers.
- A widget must **never** call `/api/agent/*` directly — those routes need a service token plus a signed `X-Aichart-User-Email` header a browser cannot produce. Widgets go through `app.callTool`, always.
- Never put credentials, account identifiers, tokens or session secrets in `structuredContent`.
- Server-enforced limits stay read-only to agent and widget.
- CRLF line endings — script find/replace silently no-ops on `\n` anchors.
- New dependency → regenerate `package-lock.json` **on the Linux VPS**, copy back, commit.
- **Do not deploy.** Stopping short of the VPS was the right call both times; keep doing it.

---

## Deliverable

One PR from this branch. In the description:

- the two fixes above, with the real post-fix numbers
- for each widget: which bucket entry it serves, and the pairing it was built on
- the origin-served vs inlined decision, stated
- how `cardButtons.test.ts` was narrowed and why
- what you verified, **including anything that did not work**

A green build is not evidence — four defects in this repo passed a clean `tsc`, a clean build and a green suite, and were caught only by exercising the deployed system. Say plainly what you could not verify without a deploy.
