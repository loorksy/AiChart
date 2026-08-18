---
name: cards
version: 2.1.0
description: Show only the Lonora recommendation card and live chart. Never present lessons, jobs, or analysis JSON as a card.
category: presentation
riskLevel: read_only
supportedLocales: ["ar", "en"]
tags: ["presentation", "cards", "widget", "ui", "layout"]
---

# Lonora recommendation cards

Gold (XAUUSD) is the only instrument. Cards carry data, never a control that places, modifies, or closes a trade.

## MCP (Claude connector)

The only interactive templates are:

1. **recommendation-card** — the host shows this automatically after a successful `create_recommendation`. Present that card. Do not invent a second layout.
2. **live-chart** — call `show_live_chart` only when the operator asks to watch gold live in chat.

There is **no** `render_cards` tool on MCP. Do not present `get_trade_lessons`, `show_jobs_by_ids`, `scan_market`, snapshots, or levels as cards. Weigh lessons in one or two sentences of prose, or skip them. Never paste `schema_version` or raw JSON.

## Web / Telegram

The platform derives the card set from the result (`deriveCards`). Do not invent a ticket, a sizer, or an approval widget. If you call `render_cards`, present the same facts the derived cards would — not a second product.

## When to show a card

- A gold recommendation issued via `create_recommendation` → the host recommendation-card (MCP) or derived cards (web), plus one or two short sentences.
- Operator asks to watch the live chart → `show_live_chart` (MCP) only.
- Greeting, clarification, lessons, job JSON, or a general question → text only.

## Reading order (web derived cards)

Use this order. Do not add execution stages.

1. `decision` — buy or sell, summary, honest confidence
2. `plan_levels` — entry, how it fills, stop, targets
3. `activation` — immediate or conditional, validity
4. `invalidation` — what proves the plan wrong
5. `alternative_scenario` — the runner-up read, if one exists
6. `gate_checklist` — G1–G7 on a pass and on a refusal
7. reasons, public reasoning, evidence, news, costs
8. `tracked_recommendation` — the stored plan, if one was issued
9. `follow_up_options` — chat chips only

Diagnostic kinds (`decision_trace`, `run_stages`, `envelope_status`, …) stay collapsed on web and are dropped on Telegram. Do not dump them as the answer.

## Buttons

The only card actions are chat:

| action | payload | effect |
|--------|---------|--------|
| submit_prompt | { text } | sends a new message |
| inject_input | { text } | fills the input |

Do not emit an order, approval, close, or size action. There is nothing to approve and no broker behind a button.

## Rules

- Localize card copy to the operator's language. Keep this skill in English.
- One recommendation story per reply. Never paste JSON into chat.
- A gate refusal is a named checklist, not a weaker ticket.
- Web and Telegram render the same derived cards. Telegram drops diagnostics; it does not change the decision.
