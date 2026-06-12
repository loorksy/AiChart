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
| موافقة أزرار | `POST /api/agent/approval/request` |
| فتح/إغلاق | `POST /api/agent/trade/open|close` |
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

## شارت MT5 (EA)

`chart_url` = `/api/agent/chart/{id}/mt5` — poll حتى HTTP 200 (كل 2ث، 5 مرات).
`503` = EA offline · `202` = انتظر. fallback: `/api/agent/chart/{id}`.

## موافقة

`approval/request` مع `practice:true` للتجربة. بعد ✅ المنصة تنفّذ.
`trade/open` يحتاج `approved_by_user:true` أو auto + شروط.

## فوركس

أضف `"market":"forex"`. diagnostics قبل التنفيذ. راجع `EA_TROUBLESHOOTING.md`.

## أخطاء

- `401` توكن · `503` جسر · Risk Guard `ok:false` = نهائي
- **10016** SL/TP · **10026** لا quotes · **10019** هامش
- لا مرشحين scan = إشارة ضعيفة فقط (ليس EA)
- crypto symbols → Binance لا MT5
