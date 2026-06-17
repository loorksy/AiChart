# AiChart MCP Changelog

## 1.1.0 — MCP Capability Upgrade (2026-06)

### New tools

| Tool | Route | Purpose |
|------|-------|---------|
| `get_trade_readiness` | `GET /api/agent/trade/readiness` | Pre-flight: EA online, fresh quotes, spread, kill switch, daily loss, **confidenceGate** |
| `get_ohlc` | `GET /api/agent/market/ohlc` | OHLC candles (forex via EA `get_ohlc`, crypto via Binance) |
| `get_forex_indicators` | `GET /api/agent/market/forex-indicators` | RSI, MACD, SMA, EMA, Bollinger, ATR, Stochastic + trend |
| `detect_levels` | `GET /api/agent/market/detect-levels` | Swing-based support/resistance + market structure |
| `request_ea_reconnect` | `POST /api/agent/ea/reconnect` | Queue EA reconnect on next heartbeat |

### Enhanced tools

- **`get_ea_live_quotes`** — `isFresh`, `spreadPips`, `source`, `freshCount`, `staleSymbols[]`
- **`capture_mt5_chart`** / **`capture_chart_snapshot`** — inline PNG (`image` content block + base64 in JSON)
- **`open_trade`** — optional `idempotencyKey`; pre-flight stale quote / EA offline rejection; confidence gate
- **`get_agent_capabilities`** — `serverVersion`, `featureFlags`, `eaHeartbeat` debounce notes

### Breaking / behavioral changes

Several bridge routes now return a **canonical envelope** instead of flat JSON:

```json
{ "ok": true, "data": { ... }, "meta": { ... } }
```

```json
{
  "ok": false,
  "error": {
    "code": "LOW_CONFIDENCE",
    "message": "...",
    "message_ar": "...",
    "retriable": false,
    "details": { "confidence": 75, "minConfidence": 80 }
  }
}
```

**Affected MCP tools (parse `ok` / `error.code`):**

- `get_risk_status`
- `get_ea_live_quotes`
- `open_trade` (denials: `LOW_CONFIDENCE`, `STALE_QUOTE`, `EA_OFFLINE`, `RISK_LIMIT_EXCEEDED`)

MCP now sets **`isError: true`** when the bridge returns `{ ok: false, error }` (HTTP 200 or 4xx/5xx with envelope body).

### Confidence gate (enforced)

- Default `min_confidence = 80` in DB / Risk Guard
- `open_trade` with `confidence < 80` → `LOW_CONFIDENCE`, no broker execution
- `get_trade_readiness?confidence=75` → `ready: false` with bilingual blocker

### EA v4 (operator)

- EA source includes `get_ohlc` + reconnect handler — **`.ex5` must be compiled manually on MT5**
- Until EA v4 is installed, OHLC may fall back to `heartbeat_cache` with warning in response

### Infrastructure

- Bridge layer: `web/src/lib/bridge/*` (errors, cache, rate limit, idempotency, freshness)
- EA heartbeat **3-strike debounce** before marking offline

## 1.0.0

Initial MCP server — ~48 tools bridging `/api/agent/*`.
