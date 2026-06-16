---
name: aichart-trading
description: تداول عبر AiChart MCP — Claude Connectors، بيانات حية، Binance/MT5، توصيات بشارت، Risk Guard.
metadata: {"aichart":{"requires":{"env":["AICHART_SERVICE_TOKEN"]}}}
---

# مهارة AiChart Trading

## القناة الأساسية: MCP (Claude Connectors)

**استخدم أدوات MCP** — راجع [`docs/MCP_CLAUDE_SETUP.md`](../../../docs/MCP_CLAUDE_SETUP.md).

| الغرض | أداة MCP |
|--------|----------|
| ملخص الحساب | `get_account_overview` |
| مخاطر/حدود | `get_risk_status` |
| محفظة/رصيد | `get_portfolio` · `get_live_account` |
| تحليل | `get_market_snapshot` · `get_market_context` · `scan_market` |
| دروس | `get_trade_lessons` (+ `recent:true`) |
| توصية | `create_recommendation` |
| تنفيذ | `open_trade` (notional + rationale إلزاميان) |
| إغلاق | `close_trade` · `evaluate_trade` |

**قواعد:** صيغة «**ندخل**» (موكّل). اسأل الزوج والمبلغ. لا تنفيذ مع «خذ صفقة» مباشرة.

Resource: `aichart://trading-rules` (يقرأ `AGENTS.md`).

---

## APIs (curl — صيانة فقط)

`$AICHART_API_URL` + `Authorization: Bearer $AICHART_SERVICE_TOKEN` — للصيانة فقط.

```bash
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  "${AICHART_API_URL:-http://localhost:3000}/api/agent/<path>"
```

## APIs أساسية

| الغرض | الطريقة |
|--------|---------|
| مخاطر/وضع/executionEnv | `GET /api/agent/risk/status` (+ `accountProfile`) |
| تقييم صفقة مفتوحة | `GET /api/agent/trade/evaluate?trade_id=` |
| قرار خروج (audit) | `POST /api/agent/trade/exit-decision` |
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

يرجع JSON: `{ ok, source, image_base64, chart_url, chart_url_public, content_type }`.

**Telegram — ممنوع** `MEDIA:http://127.0.0.1:...` أو GET على `binance-capture`.

1. `POST` كما أعلاه (Bearer token).
2. للصورة في تيليجرام استخدم **`chart_url_telegram`** مباشرة (التوكن مدمج من الخادم)  
   مثال: `MEDIA:<chart_url_telegram>` من رد `binance-capture` أو `recommendation`
3. أو أرفق `image_base64` مباشرة إن دعم القناة ذلك.

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

## تيليجرام — قائمة / عربية + Reply Keyboard

عند `/start` أو `/qaima`:
```bash
curl -s -X POST -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  "${AICHART_API_URL}/api/agent/telegram/menu"
```

| أمر / أو زر لوحة | نفّذ |
|------------------|------|
| `/qaima` · `/start` | `POST /api/agent/telegram/menu` |
| `/tahil` · `📊 تحليل زوج` | تحليل + قائمة رموز |
| `/rased` · `💰 الرصيد` | `GET /api/agent/portfolio` |
| `/safaqat` · `📈 الصفقات` | `GET /api/agent/trades/open` |
| `/iadadat` · `⚙️ الإعدادات` | `GET /api/agent/risk/status` |
| `/crypto` · `🪙 كربتو` | سوق كربتو |
| `/forex` · `💱 فوركس` | سوق فوركس |
| `/demo` · `🧪 ديمو` | `POST execution/env` demo |
| `/live` · `🔴 حقيقي` | `POST execution/env` live |

**إصلاح «البوت لا يرد» على VPS:**
```bash
bash agent/scripts/sync-telegram-bot.sh
bash infra/vps-mcp-deploy.sh
bash infra/vps-telegram-bot-health.sh
```

## أزرار تيليجرام → أوامر الوكيل

كل `callback_data` يصل كـ `[CMD:…]` — **أنت** تنفّذ عبر curl:

| callback_data | ماذا تفعل |
|---------------|-----------|
| `cmd:home` | بطاقة قائمة + `mainMenuButtons` |
| `cmd:balance` | `GET /api/agent/portfolio` → `balanceCard` |
| `cmd:trades` | `GET /api/agent/trades/open` |
| `cmd:settings` | `GET /api/agent/risk/status` |
| `cmd:market:crypto` | `POST /api/agent/market/active` أو إعدادات السوق |
| `cmd:market:forex` | نفس الأمر لـ forex |
| `cmd:env:demo` | `POST /api/agent/execution/env` `{"preference":"demo"}` |
| `cmd:env:live` | `{"preference":"live"}` |
| `cmd:analyze:pick` | اعرض رموز مسموحة ثم حلّل المختار |
| `cmd:approve:{id}` | إن ≥60ث: أعد scan؛ وإلا `POST approval/respond` approve |
| `cmd:reject:{id}` | `POST approval/respond` reject |
| `cmd:review:{id}` | `GET trade/evaluate` ثم قرّر hold/close |
| `cmd:close:{id}` | evaluate ثم `trade/close` إن مبرر |

### أزرار تحت كل بطاقة

| السياق | أزرار |
|--------|-------|
| القائمة | تحليل · كربتو/فوركس · صفقات · رصيد · إعدادات · ديمو/حقيقي |
| بعد تحليل (pending) | موافق · رفض · زوج آخر · القائمة |
| صفقة مفتوحة | مراجعة · إغلاق · القائمة |
| بعد ربح/خسارة | كمّل؟ · الصفقات · الرصيد · القائمة |

## موافقة متأخرة (≥60 ثانية)

```bash
# 1. أعد المسح
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  -X POST "${AICHART_API_URL}/api/agent/market/scan" \
  -d '{"market":"crypto","symbols":["EURUSD"],"interval":"1h"}'

# 2. موافقة (المنصة تعيد التحقق تلقائياً)
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  -X POST "${AICHART_API_URL}/api/agent/approval/respond" \
  -d '{"intent_id":12,"action":"approve"}'
```

إن أُلغيت: أرسل `cancelledTradeCard` بالسبب (انعكاس MACD، تجاوز الدخول، انتهاء 30 دقيقة).

## إدارة صفقة مفتوحة

```bash
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  "${AICHART_API_URL}/api/agent/trade/evaluate?trade_id=5"

curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  -X POST "${AICHART_API_URL}/api/agent/trade/exit-decision" \
  -d '{"trade_id":5,"decision":"close","reason":"انعكاس MACD · كسر الدعم"}'

curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  -X POST "${AICHART_API_URL}/api/agent/trade/close" \
  -d '{"trade_id":5}'
```

## رافعة وسبريد

من `risk/status` → `accountProfile.hasLeverage`, `leverage`, `spreadPips`.
فوركس: `GET /api/agent/ea/diagnostics?symbol=EURUSD` → `spreadPips`, `spreadPct`.
اذكر الرافعة والسبريد في بطاقة التحليل عند توفرها.
