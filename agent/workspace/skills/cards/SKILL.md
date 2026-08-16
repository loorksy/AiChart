---
name: cards
version: 2.0.0
description: Present a gold recommendation as derived cards — data only, never an order control.
category: presentation
riskLevel: read_only
supportedLocales: ["ar", "en"]
requiredTools: ["render_cards"]
tags: ["presentation", "cards", "widget", "ui", "layout"]
---

# Lonora recommendation cards

Cards show the analysis the engine already produced. They carry data, never markup and never a control that places, modifies, or closes a trade. Gold (XAUUSD) is the only instrument.

The platform derives the card set from the result (`deriveCards`). Do not invent a ticket, a sizer, or an approval widget. If you call `render_cards`, present the same facts the derived cards would — not a second product.

## When to show a card

- A gold recommendation or a completed analysis → cards (or `render_cards` that mirrors them), plus one or two short sentences.
- Greeting, clarification, or a general question → text only.

## Reading order

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
- One recommendation story per reply. Max two `render_cards` layout items if you call the tool; never paste JSON into chat.
- A gate refusal is a named checklist, not a weaker ticket.
- Web and Telegram render the same derived cards. Telegram drops diagnostics; it does not change the decision.
