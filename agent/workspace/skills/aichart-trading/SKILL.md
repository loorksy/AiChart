---
name: aichart-trading
description: تداول عبر AiChart — بيانات حية، صفقات Binance/MT5، توصيات بشارت، مسح، Risk Guard، ديمو/حقيقي، موافقة أزرار.
metadata: {"openclaw":{"requires":{"env":["AICHART_SERVICE_TOKEN"]}}}
---

# مهارة AiChart Trading

`$AICHART_API_URL` + `Authorization: Bearer $AICHART_SERVICE_TOKEN` — استخدم curl.

```bash
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  "${AICHART_API_URL:-http://localhost:3000}/api/agent/<path>"
```

## APIs أساسية

| الغرض | الطريقة |
|--------|---------|
| مخاطر/وضع/executionEnv | `GET /api/agent/risk/status` |
| snapshot/price/context | `GET /api/agent/market/snapshot|price|context` |
| مسح كود | `POST /api/agent/market/scan` body: `{"market","symbols","interval"}` |
| محفظة | `GET /api/agent/portfolio` |
| صفقات مفتوحة | `GET /api/agent/trades/open` → `summary_ar` |
| ذاكرة دروس | `GET /api/agent/memory/lessons?symbol=&limit=3` |
| توصية + شارت | `POST /api/agent/recommendation` |
| شارت لحظي | `POST /api/agent/chart/snapshot` |
| شارت Binance (Playwright) | `POST /api/agent/chart/binance-capture` |
| موافقة أزرار | `POST /api/agent/approval/request` |
| فتح/إغلاق | `POST /api/agent/trade/open|close` |
| Futures مراكز/أوامر | `GET /api/agent/futures/positions|orders` · `POST /api/agent/futures/modify` |
| فحص صلاحيات Binance | `GET /api/binance/verify` أو `GET /api/agent/binance/connect` |
| ديمو/حقيقي | `GET|POST /api/agent/execution/env` |
| EA تشخيص | `GET /api/agent/ea/diagnostics?symbol=` |
| وضع/Kill | `POST /api/agent/mode` · `POST /api/agent/kill-switch` |
| صيانة OCO | `POST /api/agent/maintenance` |
| صوت | `POST /api/agent/notify/voice` |

## توصية — حقول مهمة

`symbol`, `action`, `confidence`, `entry`, `stop_loss`, `take_profit`, `timeframe`,
`rationale`, `factors[]`, `pattern_name`, `chart_drawings[]`.

أنواع الرسم: `zone`, `trend_line`, `forecast_path`, `channel`, `fib_retracement`,
`price_line`, `baseline`, `marker`, `histogram_band` — نقاط: `barsAhead`, `price`.

## شارت Binance (Playwright)

**تفعيل محلي (Windows / dev):**
```powershell
cd web
npm run playwright:setup
# في web/.env:
# BINANCE_CAPTURE_ENABLED=1
npm run playwright:test-capture
# اختبار عبر الخادم (أدمن): POST /api/admin/binance-capture?symbol=BTCUSDT
```

**Docker:** `BINANCE_CAPTURE_ENABLED=1` مفعّل في `infra/Dockerfile` + Chromium مثبّت.

يتطلب `BINANCE_CAPTURE_ENABLED=1` + Chromium. عند الفشل (CAPTCHA/geo) أو وجود `chart_drawings` → fallback برمجي (`chartSnapshot`).

```bash
POST /api/agent/chart/binance-capture
{"symbol":"BTCUSDT","interval":"1h","market_type":"futures","chart_drawings":[...]}
```

يرجع JSON: `{ ok, source: "playwright"|"fallback", image_base64, content_type }`.

## شارت MT5 (EA)

`chart_url` = `/api/agent/chart/{id}/mt5` — poll حتى HTTP 200 (كل 2ث، 5 مرات).
`503` = EA offline · `202` = انتظر. fallback: `/api/agent/chart/{id}`.

## موافقة

`approval/request` مع `practice:true` للتجربة. بعد ✅ المنصة تنفّذ.
`trade/open` يحتاج `approved_by_user:true` أو auto + شروط.

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

- `side: "sell"` + `market_type: "futures"` = **شورت** حقيقي.
- `notional` = **الهامش**؛ حجم المركز = الهامش × الرافعة.
- **SL إلزامي** — بدونه Risk Guard يرفض.
- Limit entry: `"order_type": "limit", "limit_price": 62000` — SL/TP يُوضَع تلقائياً بعد التعبئة.
- يتطلب `futures_enabled` في إعدادات المستخدم + صلاحية Futures على المفتاح (prod).

```bash
GET /api/agent/futures/positions
POST /api/agent/futures/modify {"symbol":"BTCUSDT","stop_loss":64500}
GET /api/agent/futures/orders?symbol=BTCUSDT
```

- عند `[EVENT:trade_alert]` مع futures → `GET /api/agent/futures/positions` (راقب `liquidationPrice`).
- قبل futures على prod: `GET /api/agent/binance/connect?futuresRequired=1` — تأكد `enableFutures`.

## فوركس

أضف `"market":"forex"`. diagnostics قبل التنفيذ. راجع `EA_TROUBLESHOOTING.md`.

## أخطاء

- `401` → التوكن خاطئ. `503` → الجسر غير مف��ّل على المنصة.
- `ok:false` مع reason من Risk Guard → قرار نهائي، أبلغ المشغّل.
- الفوركس: أضف `"market":"forex"` للنداءات — فقط بطلب صريح من المشغّل.
- **retcode 10016** → SL/TP مرفوض عند الوسيط (ليس «صيغة EA»). جرّب يدوياً بدون stops.
- **retcode 10026** → لا سعر حي (سوق مغلق / لا quotes) — ليس «رمز مرفوض من EA».
- **retcode 10019** → هامش غير كافٍ (رافعة/رصيد).
- «مواصفات الرمز غير متاحة» → الرمز غير في heartbeat أو EA offline؛ استدعِ diagnostics.
- **لا مرشحين في scan** → إشارة فنية ضعيفة فقط؛ `HEARTBEAT_OK` — لا تربط بـ EA.
- TRXUSDT مع `activeMarket=crypto` → Binance؛ لا تنتظر مواصفات MT5.
