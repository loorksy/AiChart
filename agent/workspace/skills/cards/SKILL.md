---
name: cards
version: 1.0.0
description: Lonora interactive-card selection and rendering guidance.
category: presentation
riskLevel: read_only
supportedLocales: ["ar", "en"]
requiredTools: ["render_cards"]
tags: ["presentation", "cards", "widget", "ui", "layout"]
---

# Interactive Cards Skill

Guide for when and how to show **interactive cards** (mini UI) in Lonora instead of dry text. **English instructions** — localize card **content** to the operator's language.

## Card protocol

Cards are a **native Lonora protocol**, not model-specific. They work with any provider because:

- **Declarative data, not code**: `ui_schema = { version: "1.0", layout: UIElement[] }` where `UIElement = { id, component, props, children? }`.
- **Two layers**: (1) you call `render_cards`; (2) if you forget, the server may compose a card from tool output deterministically.

## Golden rules

- Any reply with **data** (analysis, prices, account, trades, trade proposal) → **one appropriate card** for the stage — not text alone.
- General chat / greeting / simple clarification → text only, no card.
- Always add 1–2 brief human sentences with the card.
- **One card per stage**: analysis → analysis only; trade proposal → one of record_recommendation / order_ticket / risk_reward.
- Max **two cards** in `render_cards.layout`; **one** when proposing a trade. Say why you picked the card.

## Stage → card matrix

| Stage | Card | Forbidden in same reply |
|-------|------|-------------------------|
| Pair analysis | `analysis` (RSI/SR in props) | order_ticket, risk_reward, rsi_gauge, sr_ladder |
| Trade proposal | record_recommendation **or** order_ticket **or** risk_reward | analysis + gauges together |
| After record_recommendation | no extra render_cards | repeating SL/TP |
| Pending approval | trade_confirm / intent | order_ticket + analysis |
| Account/trades | account_overview, positions_table | analysis/trade cards |

## How to show a card

**Call `render_cards`** with `layout` (1–2 elements max). **Do not paste JSON in chat** — it will not render.

## Tool → card mapping

| After tool | Show |
|------------|------|
| get_account_symbols | `pair_browser` |
| get_market_snapshot / analysis | `analysis` only |
| get_account_overview | `account_overview` |
| get_open_trades | `positions_table` |
| trade proposal | record_recommendation **or** `order_ticket` **or** `risk_reward` — one only |
| multi-symbol compare | `change_grid`, `heatmap`, or `table` |

## Component catalog (summary)

**Execution**: order_ticket, quick_trade, close_position, modify_sltp, position_sizer, risk_reward, bracket_order, trade_confirm

**Analysis**: analysis, rsi_gauge, macd_meter, trend_meter, sr_ladder, mtf_grid, pattern_card, confidence_meter, signal_strength, indicator_tabs

**Market**: pair_browser, watchlist, price_ticker, spread_monitor, movers, heatmap, change_grid, depth_mini

**Account**: account_overview, equity_sparkline, positions_table, pnl_summary, margin_gauge, allocation_donut, exposure_bars, balance_card

**Controls**: timeframe_picker, market_switch, mode_switch, strategy_picker, checklist, step_progress, fear_greed, news_feed, alert_banner, confirm_dialog, quick_actions

**Mini charts**: candles_mini, area_spark, compare_chart, range_slider_chart

## render_cards signature

```
render_cards({ layout: UIElement[] })
UIElement = { id: string, component: string, props: object, children?: UIElement[] }
```

Example:

```
render_cards({ "layout": [
  { "id": "a1", "component": "analysis", "props": {
    "symbol": "EURUSD", "price": 1.165, "trend": "neutral",
    "rsi": "41 neutral", "macd": "weak momentum",
    "support": 1.158, "resistance": 1.172,
    "summary": "Range-bound — prefer waiting."
  }}
]})
```

## Allowed card button actions

| action | payload | effect |
|--------|---------|--------|
| submit_prompt | { text } | sends text as new message |
| inject_input | { text } | fills input only |
| execute_trade | { intentId } | approves a pending intent for technical execution checks |
| reject_trade | { intentId } | rejects pending intent |

## Security

- No `on...` handlers in props — stripped.
- Execution stays behind explicit approval and technical broker safety.

## MCP vs web

- **Web chat**: always use `render_cards` tool.
- **MCP App sessions**: structured tool results may render MCP UI widgets automatically — keep prose brief alongside them.
