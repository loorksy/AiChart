# AiChartBridge MT5 — EA Commands v4

Version **4.00** adds on-demand OHLC fetch and server-initiated reconnect via heartbeat flags.

## What's new in v4

| Feature | Description |
|---------|-------------|
| `get_ohlc` command | Fetch candles on demand via `CopyRates` — ack includes `candles[]` |
| `flags.reconnect` | Server asks EA to re-sync bridge (PreWarm symbols, flush quotes, heartbeat) |
| `flags.resync_candles` | Force immediate heartbeat with candle payload |
| Heartbeat debounce (web) | EA marked offline only after **3 consecutive** missed 30s intervals |

## Compile & deploy

MetaEditor is required — `.ex5` cannot be built on this repo's CI without MT5.

1. Open **MetaEditor** → `ea/mt5/AiChartBridge.mq5`
2. **Compile** (F7) — fix any include path errors
3. In MT5: remove old EA from chart → attach new `AiChartBridge.ex5`
4. Confirm Experts log: `AiChartBridge MT5 v4.00 started`
5. Verify `query_terminal` ack shows `"ea_version":"4.00"`

### WebRequest allowlist

Ensure `https://aichart.lork.cloud` (or your `ApiBase`) is in **Tools → Options → Expert Advisors → Allow WebRequest**.

## Command: `get_ohlc`

**Queue:** `POST` creates command via web/MCP → EA polls `GET /api/ea/commands`.

**Payload:**

```json
{
  "symbol": "EURUSDm",
  "timeframe": "1h",
  "count": 200
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `symbol` | yes | Broker-exact case (`ResolveBrokerSymbol`) |
| `timeframe` | yes | `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w` or `M1`, `H1`, … |
| `count` | no | Default 200, max 500 |

**Ack result:**

```json
{
  "status": "acked",
  "result": {
    "symbol": "EURUSDm",
    "timeframe": "1h",
    "count": 200,
    "candles": [
      { "time": 1717000000, "open": 1.08, "high": 1.09, "low": 1.07, "close": 1.085, "volume": 1234 }
    ]
  }
}
```

Web persists acked candles to `ea_market_cache` automatically (`POST /api/ea/commands/{id}/ack`).

**Web helper (Phase 3 MCP):** `queueEaGetOhlc(userId, { symbol, timeframe, count })` in `web/src/lib/eaAgentCommands.ts`.

## Reconnect behavior

**Trigger:** `POST /api/agent/ea/reconnect` (bridge auth) with optional `{ "resync_candles": true }`.

**Flow:**

1. Web sets `ea_reconnect_{userId}` flag (and optionally `ea_resync_candles_{userId}`)
2. On next EA heartbeat response, web includes `flags.reconnect: true` (and/or `resync_candles`)
3. EA runs `HandleServerReconnect()`:
   - Clears heartbeat failure counter
   - `PreWarmSymbols()` — re-select Market Watch symbols
   - `FlushLiveQuotes()` — push live bid/ask
   - `SendHeartbeat()` — immediate state sync
4. Flags cleared after one delivery (one-shot)

## Heartbeat debounce (web-side)

- **Raw freshness:** `isHeartbeatFresh()` — 90s window (unchanged)
- **Debounced online:** `isEaOnlineDebounced()` — offline only after 3 missed 30s intervals
- **Settled online:** `settledOnlineSeconds` — seconds EA has been stably online (for readiness checks in Phase 3)

Trade execution (`open_trade`, `forexPreflight`, `eaAdapter`) uses **debounced** online state.

## MT status fix

When `FOREX_BACKEND=ea`, `getMtConnectionStatus()` delegates to `getEaConnectionMeta()` instead of returning `connected: false`.

## Backward compatibility

- v3.10 EA continues to work — unknown commands are acked `failed`; new flags are ignored if not parsed (upgrade recommended for OHLC).
- All v3 commands unchanged.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `get_ohlc` → `CopyRates failed` | Symbol in Market Watch; history downloaded in MT5 |
| Reconnect flag not received | EA version ≥ 4.00; heartbeat succeeding |
| Still shows offline flapping | Web debounce requires 3×30s misses; check `GET /api/agent/ea/diagnostics` for `missedHeartbeats` |
