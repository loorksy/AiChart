# Re: Phase 0 — both questions answered, proceed to Phase 1

Good inventory, and you were right to stop on the button question rather than break a guard whose reason you could not see. Here are both answers, with the history your shallow clone was missing.

---

## Q1 — the no-buttons guard: there was no production incident

I recovered the full history. `cardButtons.test.ts` was introduced in exactly one commit:

**`bdf8e665` — 2026-07-11 — "Part 6: localize MCP cards and remove card-owned actions"**

Its own message says why:

> "Removed the **dead** two-click execute-confirm helper (bindConfirm), the **now-unused** `sendFollowUpMessage` / `openLink` bridge methods, and the `.btn` / `.spacer` / `.confirming` CSS. **`callTool` is kept** (live-chart data polling only)."

Dead code removed during a localization pass — not a failure that got rolled back. The commit is scoped: *"MCP-only tranche — only the card presentation/localization layer changes."*

The second commit you saw, **`df615f8b` "make the AI agent the sole trading authority"**, touched that file to change **one word in a comment** (`Lonora` → `AiChart`). Nothing else. Reasonable inference from the title, but it is not what happened.

**`callTool` is live and works** — `mcp/src/ui/runtime.ts:210` and `:498`. It was deliberately kept. The Pattern A plumbing you were worried about already exists and is exercised by live-chart polling.

### What to do

The guard still encodes a real policy — **a card must never execute a trade** — but it is written far wider than that intent: it forbids *any* button, including one that would use the approval flow the platform already has.

**Narrow it to its intent instead of deleting it.** Replace the blanket assertion in `cardButtons.test.ts` with:

- **Allowed** from a card: `request_approval`, `respond_approval`, `get_pending_approvals`
- **Forbidden** from a card, asserted by test: `open_trade`, `close_trade`, `close_partial`, `modify_sl_tp`, `cancel_mt5_order`, and any future execution tool

A card becomes an **approval surface**, never an execution surface. The agent stays the sole trading authority; the button just answers a question the approval flow already asks. Put that reasoning in the test's comment so the next person does not have to excavate git history the way you just did.

Approve/reject buttons: **approved.** New cards: **approved.**

---

## Q2 — your widget count is the correct one

6 hand-built templates behind 16 tool-facing names. My "2 widgets" came from counting exported constants in `uris.ts`; you counted actual pairings. Yours is the real number.

Your suspicion about `scan_market`→recommendation-card and `detect_levels`→levels-card is worth checking — **but do not make either the Phase 2 target.** Build the first widget on a pairing that is already sound, then fix those two as separate work. Debugging a shape mismatch while establishing a new pattern confuses which one is broken.

---

## Use the official spec and SDK, not a generic tutorial

- **Spec + examples:** https://github.com/modelcontextprotocol/ext-apps
  Read `specification/2026-01-26/apps.mdx` (the stable spec) and `examples/` — `cohort-heatmap-server` and `scenario-modeler-server` are the closest analogues to a data-dense card, `system-monitor-server` to a live-updating panel.
- **API reference:** https://apps.extensions.modelcontextprotocol.io/api/

Read them **against** `mcp/src/ui/` before writing anything. The wiring (`registerAppResource`, `createUIResource`, `_meta.ui.resourceUri`) is already in place — the docs are there to tell you what the host guarantees and what the newer API offers that our hand-rolled `widgetHtml`/`runtime.ts` predates. Where they disagree, say so in the PR rather than quietly forking a second widget system beside the existing one.

---

## The reference standard, concretely

I read the live Higgsfield MCP schemas. Their `generate_image` description contains, verbatim, every pattern Phase 1 asks for — match this level literally:

| pattern | their wording |
|---|---|
| preflight | `get_cost:true` — *"return the cost in credits **without submitting any job**"* |
| adjustments | *"count is capped to 1 and **the cap comes back in `adjustments`**"* |
| recovery | *"If `recovery_tool` returned, **call it immediately; do not explain/ask first**"* — plus a named recovery per error code (`unlim_trial_available`, `unlim_trial_expired`, `unlim_not_supported`, …) |
| async | `jobs_wait` — 1–12 jobs, `all_terminal`, `poll_after_seconds` |
| no display loops | *"display them with **one** `show_generation_by_ids` call. **Never** use `show_generations` or call `job_display` once per batch job"* |
| honesty | *"**Never quietly re-run the same request on credits — say what happened first**"* |
| defaults spelled out | *"Defaults: `marketing_studio_image` for commercial/product/ads; `soul_cast` for text-only character…"* |
| conventions stated | *"`medias[].value` must be media_id/job_id, **not URL**"* |
| when NOT to call | *"do not ask for Claude chat attachments **because remote tools cannot read them**"* |

**The widget is one clause in that entire description** — *"render its result(s) in the generation widget."* Everything else that makes their server feel reliable is text discipline in the tool contract.

That is the whole point of ordering Phase 1 before any widget: it is where the experience actually comes from, and we have **zero** of it across 53 tools.

---

## Do now — Phase 1, steering fields across all 53 tools

Per your own Phase 0 finding: **reconcile with the existing informal `nextStep` / `note` / `image_delivery` rather than adding a parallel set.** One vocabulary, not two.

- `next_step` — fully specified next call, wired along the real chains from your inventory
- `recovery_tool` — a named fix per failure mode, or an explicit unrecoverable marker; include the *"call it immediately"* instruction in the tool description
- `adjustments` — every clamp or coercion reported, so the model never claims the requested value was used
- `assistant_response` — for consequential results, relayed verbatim; state that in the description
- `dry_run` on every bucket-A tool — full consequence figures, commits nothing, **asserted by test**

Add each to the exported schemas and run `npm run schemas:check`.

---

## Repo constraints, unchanged

- `mcp/schemas/tools/*.json` and `mcp/contracts/tools.json` are **generated**. Edit a schema → regenerate → commit both.
- `npm run typecheck`, `npm run schemas:check`, `npm run test:catalog` must pass in `mcp/`.
- The web suite must stay at **977/977, zero failures**. Any failure is yours.
- CRLF line endings — script-based find/replace silently no-ops on `\n` anchors.
- New dependency → regenerate `package-lock.json` **on the Linux VPS**, copy back, commit.
- **Do not deploy.** Stopping short of the VPS on the EA PR was the right call; keep doing that.

Commit per phase. Stop after Phase 1 for review before any widget work.
