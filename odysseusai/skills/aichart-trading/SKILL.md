# AiChart trading workspace (Odysseus embed)

Use these tools when the user asks to analyze forex, open a chart, check MT5 status, or manage trading mode.

## Workflow

1. **Open chart first** — `open_chart` with `symbol` + `interval` (default 15m, source oanda).
2. **Check readiness** — `get_mt5_status` and `get_risk_settings` before proposing trades.
3. **Analyze** — `analyze_market` for structured analysis; the chart updates in chat automatically.
4. **Recommend** — `create_recommendation` in semi-auto (`approval`) mode; user gets an Execute card.
5. **Execute** — `execute_mt5_order` only with `stop_loss` set; in semi-auto prefer user Execute in chat.

## Modes

| User intent | `set_trading_mode` |
|-------------|-------------------|
| Analysis only | `manual` or `direct` |
| Confirm each trade | `semi_auto` or `approval` |
| Auto with Risk Guard | `full_auto` or `auto` |

## Rules

- Odysseus does **not** execute trades locally — all execution goes through AiChart bridge.
- User must have an AiChart account with the **same email** as Odysseus.
- Never call `execute_mt5_order` without `stop_loss`.
- Use `emergency_stop` when the user asks to stop trading immediately.
