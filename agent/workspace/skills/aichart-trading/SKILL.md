---
name: aichart-trading
description: Trade via AiChart MCP — Claude Connectors, live data, Binance/MT5, chart recommendations, Risk Guard.
metadata: {"aichart":{"requires":{"env":["AICHART_SERVICE_TOKEN"]}}}
---

# AiChart Trading Skill

## Primary Channel: MCP (Claude Connectors)

**Use MCP Tools** — Refer to [`docs/MCP_CLAUDE_SETUP.md`](../../../docs/MCP_CLAUDE_SETUP.md).

| Purpose | MCP Tool |
|---------|----------|
| Account Overview | `get_account_overview` |
| Risk / Limits Status | `get_risk_status` |
| Portfolio / Balance | `get_portfolio` · `get_live_account` |
| Market Analysis | `get_market_snapshot` · `get_market_context` · `scan_market` |
| Lessons History | `get_trade_lessons` (+ `recent:true`) |
| Recommendation | `create_recommendation` |
| Execution | `open_trade` (rationale + **mandatory `stop_loss`** + `entry`/`take_profit` for R:R; notional optional — auto-sized from stop distance) |
| Position Closure | `close_trade` · `evaluate_trade` |

**Rule:** Use "We enter" or "We open" (Agent identity). Ask the user for the **symbol** and the **allocation amount** when not given — but **never ask for the direction**: you decide buy/sell yourself from analysis. Never execute a trade immediately upon receiving a simple "open a trade" request.

**Objective discipline (not a confidence gate):** every entry MUST carry a defined stop-loss and a reward:risk ≥ `min_rr` (default 1). Risk Guard rejects a stopless order or one whose target is closer than its stop. Confidence is for sizing/audit, never a threshold.

Resources: `aichart://trading-rules` (reads `AGENTS.md`) · `aichart://execution-desk` (4-agent committee + discipline framework).

---

## APIs (curl — Maintenance Only)

`$AICHART_API_URL` + `Authorization: Bearer $AICHART_SERVICE_TOKEN` — For maintenance only.

```bash
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  "${AICHART_API_URL:-http://localhost:3000}/api/agent/<path>"
```

## Core API Endpoints

| Purpose | Method & Endpoint |
|---------|-------------------|
| Risk / Environment Status | `GET /api/agent/risk/status` (+ `accountProfile`) |
| Evaluate Open Position | `GET /api/agent/trade/evaluate?trade_id=` |
| Exit Decision (Audit) | `POST /api/agent/trade/exit-decision` |
| Snapshot / Price / Context | `GET /api/agent/market/snapshot|price|context` |
| Market Scanner | `POST /api/agent/market/scan` body: `{"market","symbols","interval"}` |
| Portfolio Details | `GET /api/agent/portfolio` |
| Open Positions | `GET /api/agent/trades/open` → `summary_ar` |
| Trade Lessons Memory | `GET /api/agent/memory/lessons?symbol=&limit=3` |
| Recommendation + Chart | `POST /api/agent/recommendation` |
| Live Chart Snapshot | `POST /api/agent/chart/snapshot` |
| Binance Chart (Playwright) | `POST /api/agent/chart/binance-capture` |
| Request Approval Buttons | `POST /api/agent/approval/request` |
| Open / Close Trade | `POST /api/agent/trade/open|close` |
| Futures Positions / Orders | `GET /api/agent/futures/positions|orders` · `POST /api/agent/futures/modify` |
| Verify Binance Credentials | `GET /api/binance/verify` or `GET /api/agent/binance/connect` |
| Demo / Live Environment | `GET|POST /api/agent/execution/env` |
| EA Diagnostics | `GET /api/agent/ea/diagnostics?symbol=` |
| Trading Mode / Kill Switch | `POST /api/agent/mode` · `POST /api/agent/kill-switch` |
| OCO Maintenance | `POST /api/agent/maintenance` |
| Voice Notifications | `POST /api/agent/notify/voice` |

---

## Recommendations — Key Fields

`symbol`, `action`, `confidence`, `entry`, `stop_loss`, `take_profit`, `timeframe`,
`rationale`, `factors[]`, `pattern_name`, `chart_drawings[]`.

Valid drawing types: `zone`, `trend_line`, `forecast_path`, `channel`, `fib_retracement`,
`price_line`, `baseline`, `marker`, `histogram_band` — points: `barsAhead`, `price`.

---

## Binance Charting (Playwright)

**Local Setup (Windows / dev):**
```powershell
cd web
npm run playwright:setup
# in web/.env:
# BINANCE_CAPTURE_ENABLED=1
npm run playwright:test-capture
# Test via admin endpoint: POST /api/admin/binance-capture?symbol=BTCUSDT
```

**Docker Setup:** `BINANCE_CAPTURE_ENABLED=1` is enabled by default in `infra/Dockerfile` + Chromium installed.

If capture fails (due to CAPTCHA/geo restrictions) or `chart_drawings` is provided → Fallback to programmatically generated canvas chart (`chartSnapshot`).

```bash
POST /api/agent/chart/binance-capture
{"symbol":"BTCUSDT","interval":"1h","market_type":"futures","chart_drawings":[...]}
```

Returns JSON: `{ ok, source, image_base64, chart_url, chart_url_public, content_type }`.

**Telegram Warning:** Never use local URLs `http://127.0.0.1:...` or GET directly on `binance-capture` images.
1. `POST` as shown above (using Bearer token).
2. For Telegram images, use the returned **`chart_url_telegram`** directly (auth token is pre-baked by the server).
   Example: `MEDIA:<chart_url_telegram>`
3. Or attach `image_base64` directly if supported by the channel.

---

## MT5 Charting (EA)

`chart_url` = `/api/agent/chart/{id}/mt5` — Poll every 2 seconds, up to 5 times.
`503` = EA offline · `202` = Pending. Fallback: `/api/agent/chart/{id}`.

---

## Approvals

Use `practice:true` on `approval/request` for testing. Once approved, the platform executes.
`trade/open` requires `approved_by_user:true` or satisfies auto-trade rules.

---

## Futures (Binance USDT-M)

```bash
POST /api/agent/trade/open
{
  "symbol": "BTCUSDT", "side": "sell",
  "notional": 50, "market_type": "futures", "leverage": 3,
  "stop_loss": 64200, "take_profit": 61500,
  "order_type": "market", "approved_by_user": true
}
```

- `side: "sell"` + `market_type: "futures"` = **Short** trade.
- `notional` = **Margin**; position size = margin × leverage.
- **SL is mandatory** — Risk Guard will reject requests without a stop loss.
- Limit entry: `"order_type": "limit", "limit_price": 62000` — SL/TP will be placed automatically after filling.
- Requires `futures_enabled` in user settings + Futures permissions granted on the API key (production).

```bash
GET /api/agent/futures/positions
POST /api/agent/futures/modify {"symbol":"BTCUSDT","stop_loss":64500}
GET /api/agent/futures/orders?symbol=BTCUSDT
```

- When `[EVENT:trade_alert]` triggers for futures → call `GET /api/agent/futures/positions` and monitor `liquidationPrice`.
- Before executing futures on prod: call `GET /api/agent/binance/connect?futuresRequired=1` to ensure `enableFutures` is active.

---

## Forex (MT5)

Add `"market":"forex"` to your calls. Run diagnostics before trade execution. See `EA_TROUBLESHOOTING.md`.

---

## Errors & Troubleshooting

- `401` → Invalid authorization token. `503` → Bridge is not enabled on the web console.
- `ok:false` with a reason from Risk Guard → Final decision, report the reason to the operator.
- Forex: Add `"market":"forex"` to requests — only when explicitly requested by the user.
- **retcode 10016** → SL/TP rejected by broker (invalid stop levels). Try executing manually **without stops**.
- **retcode 10026** → Off quotes (no active prices or market closed). Do not assume market is closed; verify Market Watch and `quoteAgeMs` via diagnostics.
- **retcode 10019** → Insufficient margin (check leverage/balance).
- "Symbol specifications not available" → Symbol not found in heartbeat or EA is offline. Run diagnostics.
- **No candidates in scan** → Technical indicator signals are weak; `HEARTBEAT_OK` only. Do not diagnose EA connection issues based on this.
- TRXUSDT with `activeMarket=crypto` → Routes to Binance. Do not look for MT5 specs.

---

## Telegram Arabic Keyboard & Menus

On `/start` or `/qaima`:
```bash
curl -s -X POST -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  "${AICHART_API_URL}/api/agent/telegram/menu"
```

| Command / Button | Execution Endpoint / Action |
|------------------|-----------------------------|
| `/qaima` · `/start` | `POST /api/agent/telegram/menu` |
| `/tahil` · `📊 تحليل زوج` | Analyze + List symbols |
| `/rased` · `💰 الرصيد` | `GET /api/agent/portfolio` |
| `/safaqat` · `📈 الصفقات` | `GET /api/agent/trades/open` |
| `/iadadat` · `⚙️ الإعدادات` | `GET /api/agent/risk/status` |
| `/crypto` · `🪙 كربتو` | Crypto market configuration |
| `/forex` · `💱 فوركس` | Forex market configuration |
| `/demo` · `🧪 ديمو` | `POST execution/env` demo |
| `/live` · `🔴 حقيقي` | `POST execution/env` live |

**Fixing Telegram Bot Unresponsiveness on VPS:**
```bash
bash agent/scripts/sync-telegram-bot.sh
bash infra/vps-mcp-deploy.sh
bash infra/vps-telegram-bot-health.sh
```

---

## Telegram Callback Data Mapping

Callback button clicks send `[CMD:…]` messages. Handle these command codes:

| callback_data | Action to Perform |
|---------------|-------------------|
| `cmd:home` | Home menu card + `mainMenuButtons` |
| `cmd:balance` | `GET /api/agent/portfolio` → `balanceCard` |
| `cmd:trades` | `GET /api/agent/trades/open` |
| `cmd:settings` | `GET /api/agent/risk/status` |
| `cmd:market:crypto` | `POST /api/agent/market/active` or update market settings |
| `cmd:market:forex` | Same as above for forex |
| `cmd:env:demo` | `POST /api/agent/execution/env` `{"preference":"demo"}` |
| `cmd:env:live` | `{"preference":"live"}` |
| `cmd:analyze:pick` | Show allowed assets and analyze the selected symbol |
| `cmd:approve:{id}` | If ≥60s: Rescan market; else `POST approval/respond` approve |
| `cmd:reject:{id}` | `POST approval/respond` reject |
| `cmd:review:{id}` | `GET trade/evaluate` then decide hold or close |
| `cmd:close:{id}` | evaluate then `trade/close` if justified |

### Interactive Button Layouts

| Context | Attached Buttons |
|---------|------------------|
| Main Menu | Analyze · Crypto/Forex · Trades · Balance · Settings · Demo/Live |
| Pending Analysis | Approve · Reject · Switch Symbol · Home Menu |
| Open Position | Review · Close Position · Home Menu |
| Post-Trade Close | Continue? · Open Trades · Balance · Home Menu |

---

## Delayed Approvals (≥60 seconds)

```bash
# 1. Rescan the asset
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  -X POST "${AICHART_API_URL}/api/agent/market/scan" \
  -d '{"market":"crypto","symbols":["EURUSD"],"interval":"1h"}'

# 2. Re-send Approval
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  -X POST "${AICHART_API_URL}/api/agent/approval/respond" \
  -d '{"intent_id":12,"action":"approve"}'
```

If canceled: Send `cancelledTradeCard` detailing the reason (e.g., MACD reversal, price moved past entry, or 30-minute expiry reached).

---

## Managing Open Trades

```bash
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  "${AICHART_API_URL}/api/agent/trade/evaluate?trade_id=5"

curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  -X POST "${AICHART_API_URL}/api/agent/trade/exit-decision" \
  -d '{"trade_id":5,"decision":"close","reason":"MACD reversal & support break"}'

curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  -X POST "${AICHART_API_URL}/api/agent/trade/close" \
  -d '{"trade_id":5}'
```

---

## Leverage & Spreads

Read from `risk/status` → `accountProfile.hasLeverage`, `leverage`, `spreadPips`.
Forex: `GET /api/agent/ea/diagnostics?symbol=EURUSD` → `spreadPips`, `spreadPct`.
Include leverage and spread details in the analysis card when available.
