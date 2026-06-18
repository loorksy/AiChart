# AiChartBridge MT5 — Changelog

## Heartbeat payload (all versions)

`POST /api/ea/heartbeat` → `symbols[]` stored as `symbol_specs_json` on the server.

Each symbol entry includes **live** `bid`/`ask` read via `SymbolInfoDouble` at **`SendHeartbeat()` time** (not cached from a prior heartbeat), plus contract specs (`digits`, `point`, `contract_size`, `stops_level`, …).

**Important:** this is a **~30s snapshot** (plus trade-sync / chart-change triggers), **not** the tick stream. Trade pricing must use `POST /api/ea/quotes` (`FlushLiveQuotes`), not heartbeat bid/ask.

## v4.01 (2026-06-17) — Quote flush cadence fix

### Quote push
- `EventSetTimer(1)` — `ProcessBridgeTick` runs every second even when the chart symbol is quiet (was 30s).
- `FlushChartSymbolQuote()` on every `OnTick` for the chart symbol (throttle `ChartQuoteThrottleMs`, default 300ms).
- `FlushLiveQuotes()` batch unchanged (`QuoteFlushSeconds`, default 1s).
- Quote POST failures logged (`g_quote_failures`, parallel to heartbeat).

### Deploy
1. Compile in MetaEditor; reattach on EURUSDm chart.
2. Confirm `ea_version: "4.01"` in logs.
3. Run `infra/tmp-test-quote-freshness.py` on VPS (≥2 min) — p95 `quoteAgeMs` ≤ 3000ms.

## v4.00 (2026-06-17) — get_ohlc + reconnect flags

### New command
- **`get_ohlc`**: `{ symbol, timeframe, count? }` → `CopyRates` → ack with `candles[]` (max 500 bars).
- Web ack handler saves candles to `ea_market_cache`.

### Reconnect
- Heartbeat flags `reconnect` / `resync_candles` (set via `POST /api/agent/ea/reconnect`).
- `HandleServerReconnect()` — PreWarm symbols, flush quotes, immediate heartbeat.

### Web (paired deploy)
- 3-strike heartbeat debounce (`missedHeartbeats`, `settledOnlineSeconds`).
- `getMtConnectionStatus` delegates to EA meta when `FOREX_BACKEND=ea`.

### Deploy
1. Compile in MetaEditor (see `EA_COMMANDS_V4.md`).
2. Reattach EA; confirm `ea_version: "4.00"`.
3. Deploy web before or with EA — reconnect flags are web-driven.

## v3.10 (2026-06-16) — Keepalive timer + offline fix

### Keepalive
- `EventSetTimer(30)` in `OnInit` — re-armed in `OnTimer` + `OnChartEvent` after chart changes.
- Poll/heartbeat/quotes on `OnTick` (1s cadence) + watchdog `OnTimer(30)`.
- Removed `EventSetMillisecondTimer` (MQL5 allows one timer only).

### ChartSetSymbolPeriod
- Verified **zero** calls in `.mq5` — gate: `grep ChartSetSymbolPeriod ea/mt5/*.mq5` must be empty.

### Deploy
1. Compile + reattach; `ea_version: "3.10"`.
2. Confirm EA stays online >5 min after TF change.

## v3.09 (2026-06-16) — Colors + Chart Resilience

### Color parsing fix
- Replaced `ParseHexColor` (`StringToInteger("0x…")` → black) with `HexToColor` + `HexCharToLong` + `RGB(r,g,b)`.
- Default drawing color: `#3A86FF`.

### Chart timeframe change
- `OnChartEvent(CHARTEVENT_CHART_CHANGE)` — immediate heartbeat + Experts log (re-enable AutoTrading manually).
- `OnDeinit` — `EventKillTimer()` stops millisecond timer (MQL5 unified API).

### Fill
- `ApplyFillStyle()` — `OBJPROP_FILL` + `OBJPROP_BGCOLOR` + `OBJPROP_BACK` on rectangle/zone/triangle/ellipse.

### Deploy
1. Compile + reattach EA; `ea_version: "3.09"`.
2. Verify colored drawings (not black) in chart capture PNG.

## v3.08 (2026-06-16) — Fix AutoTrading disabled on chart draw

### Critical fix
- **Removed `ChartSetSymbolPeriod()`** from the drawing path — MT5 disables AutoTrading when chart symbol/period changes.
- Drawings use `ResolveTimeframe()` + `iTime(sym, tf, offset)` for coordinates only; the displayed chart is never switched.
- Removed `WaitForChartSymbolPeriod()`.

### Deploy
1. Compile + reattach EA; confirm `ea_version: "3.08"`.
2. Verify AutoTrading stays enabled after `draw_and_capture`.

## v3.07 (2026-06-16) — Complete Chart Drawing System

### Drawing engine
- `DrawMt5Object()` — 20+ MT5 object types (hline, vline, trend, rectangle, triangle, ellipse, arrows, fib/gann, text, label).
- Legacy adapter: `price_line`→hline, `zone`→rectangle, `forecast_path`→trend segments, `marker`→arrow up/down.
- Flat coords: `price`, `time_offset`, `price2`, `time_offset2` alongside `points[]`.
- `TimeFromBarOffset()` — `iTime==0` fallback to bar 0 then `TimeCurrent()`.
- Style: `width`, `style` (solid/dashed/dotted), `fill`, `fill_color`, `font_size`.

### Smart timeframe
- `ResolveTimeframe()` — Binance (`1h`) + MT5 (`H1`) formats; empty/`chart` → `Period()` (not H1).
- Time coords via `iTime(sym, tf, offset)` — **no** `ChartSetSymbolPeriod` (v3.08+).

### Symbol case (unchanged from v3.06)
- No `StringToUpper` on symbols; `ResolveBrokerSymbol` in chart capture path.

### Deploy
1. Compile + reattach EA; `ea_version: "3.07"`.
2. Poll chart: `GET /api/agent/chart/{id}/mt5` until 200 PNG.

## v3.06 (2026-06-16) — ResolveBrokerSymbol (Exness case fix)

### Symbol case (EURUSDm not EURUSDM)
- `ResolveBrokerSymbol()` — case-insensitive Market Watch lookup; returns broker-exact spelling; **never** `StringToUpper`.
- All command paths (`open_market`, `open_pending`, `ensure_symbol`, chart capture) resolve before `SymbolSelect`/`OrderSend`.
- `IsSymbolValid()` delegates to `ResolveBrokerSymbol`.

### Deploy
1. Compile + reattach EA; confirm `ea_version: "3.06"`.
2. Deploy web if not already (bridge must not uppercase forex symbols).

## v3.05 (2026-06-15) — Exness Case-Sensitive Symbols + Diagnostics

### Symbol handling (fixes Exness `EURUSDm` vs `EURUSDM`)
- EA preserves exact symbol case from API — no uppercase normalization.
- `IsSymbolValid()` + `GetMarketWatchSymbols()` — ack errors list available Market Watch symbols.
- `LogAvailableSymbols()` on attach — full symbol list in Experts tab.
- `Sleep(200)` after `SymbolSelect` before order execution (tick subscription wait).

### Bridge (web)
- `resolveMt5Symbol()` returns broker-exact case from heartbeat (e.g. `EURUSDm`).
- Forex intents no longer uppercased in `trade/open`; canonical base maps `EURUSD` → `EURUSDm`.

### Deploy
1. MetaEditor → Compile `ea/mt5/AiChartBridge.mq5` (F7).
2. Remove EA from chart and reattach; confirm log: `AiChartBridge MT5 v3.05 started`.
3. Deploy `aichart-web` if testing bridge symbol resolution on VPS.
4. `GET /api/agent/ea/query-terminal` → `ea_version: "3.05"`.

## v3.01 (2026-06-16) — Instant Execution + Filling Mode

### Order execution (fixes retcode 10026 on Instant Execution brokers e.g. Liirat)
- `ResolveFillingMode()` — auto IOC → FOK → RETURN from `SYMBOL_FILLING_MODE`.
- `ConfigureTradeForSymbol()` — `SetTypeFilling` + deviation ≥ 20 points.
- Market orders: explicit tick price (`ask`/`bid`) when execution is instant/exchange; `price=0` only for market execution mode.
- Pending orders: normalized price, dynamic filling, retry on 10004/10026/10027.
- `LogTradeRequest()` — prints full request fields to Experts tab before each send.

### Remote diagnostics
- Heartbeat `symbols[]`: `trade_execution`, `filling_mode`, `spread_points`.
- `query_terminal` ack: `reference_symbol`, `trade_execution`, `filling_mode`, bid/ask.

### Deploy
1. MetaEditor → open `ea/mt5/AiChartBridge.mq5` → Compile (F7).
2. Reattach EA on chart; confirm log: `AiChartBridge MT5 v3.01 started`.
3. Test manual market order, then MCP `open_trade`.

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
