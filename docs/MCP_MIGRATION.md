# AiChart MCP Migration Guide (1.0 → 1.1)

Guide for agents and integrators updating to the MCP Capability Upgrade.

## Quick checklist

1. Call **`get_agent_capabilities`** at session start — read `serverVersion`, `featureFlags`, `eaHeartbeat`.
2. Before forex trades: **`get_trade_readiness`** then **`get_ea_live_quotes`** (check `isFresh`, `quoteAgeMs`).
3. Parse **`ok` / `error.code`** on envelope responses — MCP sets `isError: true` on failures.
4. Enforce **confidence ≥ 80%** on live accounts (`open_trade` rejects below threshold).
5. Compile & attach **EA v4** on MT5 for on-demand OHLC (`get_ohlc`).

---

## New tools

### `get_trade_readiness`

Pre-flight aggregator before `open_trade`.

```
GET /api/agent/trade/readiness?symbol=EURUSD&market=forex&confidence=85
```

Example response (simplified):

```json
{
  "ready": true,
  "blockers": [],
  "checks": {
    "eaOnline": true,
    "quoteFresh": true,
    "confidenceGate": {
      "minConfidence": 80,
      "tradeConfidence": 85,
      "passes": true
    }
  },
  "snapshotAt": "2026-06-17T12:00:00.000Z"
}
```

When `confidence` is below threshold:

```json
{
  "ready": false,
  "blockers": [
    { "code": "LOW_CONFIDENCE", "message_ar": "الثقة 75% أقل من الحد 80% — انتظر" }
  ]
}
```

### `get_ohlc`

```json
// MCP: get_ohlc { "symbol": "EURUSD", "interval": "1h", "market": "forex", "limit": 100 }
```

Forex uses EA command `get_ohlc`. Crypto uses Binance klines. Cached ~45s.

### `get_forex_indicators`

Computes indicators from OHLC (same cache). Returns `computedFrom: "mt5_ohlc"`, `trend`, `cachedAt`, `ageMs`.

### `detect_levels`

Swing-based support/resistance, `nearestSupport`, `nearestResistance`, `structure` (uptrend/downtrend/range).

### `request_ea_reconnect`

```json
// MCP: request_ea_reconnect { "resync_candles": true }
```

Sets reconnect flag for next EA heartbeat (~30s). Do not spam — max once per minute.

---

## Error envelope format

Success:

```json
{
  "ok": true,
  "data": { ... },
  "meta": { "requestId": "...", "cachedAt": "..." }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "STALE_QUOTE",
    "message": "Quote is stale",
    "message_ar": "السعر قديم — لا ننفّذ",
    "retriable": true,
    "retryAfterMs": 2000,
    "details": { "quoteAgeMs": 12000 }
  }
}
```

### Error codes

| Code | Meaning | Retriable |
|------|---------|-----------|
| `LOW_CONFIDENCE` | confidence < min_confidence (80) | No |
| `STALE_QUOTE` | quoteAgeMs > STALE_QUOTE_MS | Yes |
| `EA_OFFLINE` | EA not connected / 3-strike offline | Yes |
| `RISK_LIMIT_EXCEEDED` | Risk Guard deny | No |
| `SPREAD_TOO_WIDE` | spread > MAX_SPREAD_PIPS | Yes |
| `RATE_LIMITED` | bridge write rate limit | Yes |
| `UPSTREAM_TIMEOUT` | broker/EA timeout | Yes |
| `VALIDATION_ERROR` | bad input | No |
| `MARKET_CLOSED` | session closed | No |

---

## Confidence gate

- **Default:** `min_confidence = 80` (DB column `trading_settings.min_confidence`)
- **`open_trade`:** always pass `confidence`; denials return `LOW_CONFIDENCE`
- **`get_trade_readiness`:** optional `confidence` query param for pre-check
- **Demo/practice:** may use relaxed floor (50) when `practice: true` — live always uses 80

---

## Breaking changes for agents

### 1. Envelope parsing

Old flat responses on some routes are wrapped:

```diff
- { "killSwitch": false, "mode": "direct" }
+ { "ok": true, "data": { "killSwitch": false, "mode": "direct" } }
```

Update parsers to read `data` when `ok === true`.

### 2. MCP `isError` flag

When bridge returns `{ ok: false, error }`, MCP tool result includes **`isError: true`** even on HTTP 200.

### 3. Live quotes freshness

Use `isFresh` and `freshCount` — do not trade when `quoteAgeMs > 5000` or `isFresh === false`.

### 4. EA offline debounce

EA is marked offline only after **3 consecutive missed heartbeats** (~90s worst case). Do not assume instant offline on a single gap.

---

## Environment variables

See [`web/.env.example`](../web/.env.example) and [`mcp/README.md`](../mcp/README.md).

Key bridge vars:

| Variable | Default | Purpose |
|----------|---------|---------|
| `STALE_QUOTE_MS` | 5000 | Quote freshness threshold |
| `MAX_SPREAD_PIPS` | 30 | Forex spread reject |
| `BRIDGE_RATE_LIMIT_WRITES` | 10 | Writes per user/route/minute |
| `IDEMPOTENCY_TTL_HOURS` | 24 | open_trade idempotency retention |
| `FOREX_BACKEND` | ea | `ea` \| `metaapi` \| `mt5local` |

---

## EA v4 operator steps

1. Compile `ea/mt5/AiChartBridge.mq5` in MetaEditor → `.ex5`
2. Attach updated EA on MT5 chart
3. Verify `get_ohlc` and reconnect via smoke scripts
4. See [`ea/mt5/EA_COMMANDS_V4.md`](../ea/mt5/EA_COMMANDS_V4.md)

---

## Smoke tests (VPS)

```bash
python3 infra/tmp-test-mcp-readiness.py
python3 infra/tmp-test-bridge-isolation.py   # if present
```
