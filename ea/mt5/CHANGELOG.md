# AiChartBridge MT5 — Changelog

## v3.00 (2026-06-15) — Live Account Bridge

### Live streaming
- `POST /api/ea/quotes` — push bid/ask every `QuoteFlushSeconds` (default 1s).
- `POST /api/ea/event` — immediate trade events on `OnTradeTransaction`.
- `PreWarmSymbols()` on attach — EURUSD, GBPUSD, USDJPY, XAUUSD + Market Watch.

### Quote reliability
- `WaitForLiveQuotes()` — retries with delay before off-quotes fail.
- Retry **10026** (off quotes) in `TryMarketOrder` alongside 10004/10027.

### Full command parity
- `open_pending` — limit / stop / stop_limit orders.
- `cancel_order` — cancel pending by ticket.
- `close_partial` — partial position close.
- `ensure_symbol` — SymbolSelect + live tick wait.
- `query_terminal` — margin, equity, pending orders in ack.

### Backend / MCP
- `GET /api/agent/live/account` — unified MT5 + Binance live view.
- MCP tools: live account, diagnostics, chart capture, pending/partial, futures.

## v2.00 (2026-06-15)

### FIX 1 — Heartbeat resilience
- Default heartbeat interval raised to **30 seconds** (was 1s).
- Immediate heartbeat on EA attach (`OnInit`).
- Failure counter with periodic log; auto-recovery message when connection returns.
- `OnTradeTransaction` + `AutoSync` sends debounced heartbeat on position changes.

### FIX 2 — Off quotes (retcode 10026)
- `HasLiveQuotes()` checks bid/ask and symbol trade mode before any market order.
- Clear ack error: `off quotes: no live bid/ask for {symbol}`.
- No retry on off-quotes (fail fast). *(superseded by v3 WaitForLiveQuotes)*

### FIX 3 — Broker busy / requote (10027, 10004)
- `TryMarketOrder`, `TryPositionClose`, `TryPositionModify` retry up to `MaxRetries` (default 3) with `RetryDelayMs` (default 500ms).

### FIX 4 — Position sync
- Positions included in every heartbeat (`BuildPositions`).
- Immediate heartbeat on trade events when `AutoSync=true`.
- Backend reconciles tickets into `aichartTrades` (see web `eaPositionSync.ts`).

### FIX 5 — Remote modify SL/TP
- New command handler: `modify_sl_tp` with payload `{ ticket, stop_loss, take_profit? }`.
- Wired from `POST /api/agent/trade/exit-decision` with `decision=adjust_sl`.

### FIX 6 — Kill Switch
- Heartbeat response `flags.kill_switch` halts new `open_market` commands.
- `flags.close_open_trades` pulse closes all MT5 positions locally.
- Backend queues `close_position` commands when kill switch activates with `close_open_trades`.

### FIX 7 — Stop loss required
- Input `AllowNoSL` (default `false`): rejects orders without `stop_loss`.
- Backend `eaAdapter` also rejects intents with no SL before queueing.

### Other
- Fast command polling via `GET /api/ea/commands` every `PollIntervalMs` (default 1000ms).
- Heartbeat used for state + kill-switch flags only (commands via poll).
- Improved command idempotency (`g_acked_ids` ring buffer).
- New inputs: `PollIntervalMs`, `AllowNoSL`, `MaxRetries`, `RetryDelayMs`, `AutoSync`.

## v1.03
- Chart drawing + screenshot upload (`draw_and_capture`, `clear_chart`).

## v1.01
- Initial heartbeat + `open_market` / `close_position` commands.
