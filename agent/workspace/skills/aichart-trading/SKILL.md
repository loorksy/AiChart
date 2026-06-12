---
name: aichart-trading
description: التداول الحقيقي عبر منصة AiChart — بيانات سوق حية، فتح وإغلاق صفقات حقيقية على Binance/MetaTrader خلف Risk Guard، تسجيل توصيات مع شارت مرسوم، مسح فرص، وإدارة وضع التداول وKill Switch. استخدمها لأي طلب تحليل سوق أو تداول أو متابعة محفظة.
metadata: {"openclaw":{"requires":{"env":["AICHART_SERVICE_TOKEN"]}}}
---

# مهارة AiChart Trading

كل النداءات تذهب إلى `$AICHART_API_URL` (افتراضياً `http://localhost:3000`)
مع الترويسة `Authorization: Bearer $AICHART_SERVICE_TOKEN`.

استخدم `exec` بـ curl. مثال القالب:

```bash
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  "${AICHART_API_URL:-http://localhost:3000}/api/agent/risk/status"
```

## 1) قبل أي قرار — حالة المخاطر والوضع

```bash
GET /api/agent/risk/status
```

يرجع: `mode`، `killSwitch`، `executionEnv` (ديمو/حقيقي)، حدود رأس المال، الصفقات
المفتوحة، وربح/خسارة اليوم والشهر. **التزم بالوضع المذكور في AGENTS.md.**

## 2) بيانات السوق

```bash
GET /api/agent/market/snapshot?symbol=BTCUSDT&interval=1h   # RSI/MACD/SMA/الاتجاه
GET /api/agent/market/price?symbol=BTCUSDT                  # سعر لحظي
GET /api/agent/market/context?symbol=BTCUSDT&interval=4h    # أخبار + خوف/طمع
POST /api/agent/market/scan          # مسح رخيص لقائمة المراقبة
# body اختياري: {"market":"crypto"|"forex","symbols":["EURUSD"],"interval":"1h"}
# إن حُذف market يُستخدم active_market من الإعدادات
```

`scan` يرجع مرشحين فقط عند تطابق عدة إشارات فنية — حلّل بعمق فقط عند وجود مرشح.

## 3) المحفظة والصفقات المفتوحة

```bash
GET /api/agent/portfolio
```

أرصدة Binance، الصفقات المفتوحة والأخيرة، النوايا المعلقة، آخر التوصيات.

## 4) تسجيل توصية مع شارت مرسوم

**قبل أي توصية:** استدعِ ذاكرة الدروس إن وُجدت:

```bash
GET /api/agent/memory/lessons?symbol=BTCUSDT&limit=3
```

إن وُجد درس مشابه (score > 0.75) — **اذكره صراحةً** في `rationale`.

```bash
POST /api/agent/recommendation
{
  "symbol": "BTCUSDT", "action": "buy", "confidence": 82,
  "entry": 61500, "stop_loss": 60700, "take_profit": 63500,
  "timeframe": "1h",
  "rationale": "شرح مترابط للقرار",
  "factors": ["[فني] RSI 28 تشبع بيعي", "[فني] ارتداد من دعم 60800", "[مزاج] خوف شديد 22"],
  "pattern_name": "قاع مزدوج",
  "chart_drawings": [
    {"type":"zone","label":"منطقة طلب","confidence":80,
     "points":[{"barsAhead":0,"price":60800},{"barsAhead":0,"price":61200}]},
    {"type":"forecast_path","label":"مسار متوقع","confidence":70,
     "points":[{"barsAhead":5,"price":62200},{"barsAhead":12,"price":63400}]}
  ]
}
```

يرجع `chart_url` — **حمّل الصورة وأرفقها في رسالتك دائماً**.

عند اتصال EA على MetaTrader 5 يكون المسار `/api/agent/chart/{id}/mt5` ويرجع
`mt5_pending: true` حتى تُرفع اللقطة من المنصّة. **انتظر اللقطة بإعادة المحاولة:**

```bash
CHART_URL="/api/agent/chart/42/mt5"   # من حقل chart_url في الرد
for i in 1 2 3 4 5; do
  CODE=$(curl -s -o /tmp/aichart-rec.png -w "%{http_code}" \
    -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
    "${AICHART_API_URL}${CHART_URL}")
  if [ "$CODE" = "200" ]; then break; fi
  if [ "$CODE" = "503" ]; then echo "EA غير متصل — استخدم chart_url القديم أو أبلغ المشغّل"; break; fi
  sleep 2
done
```

- `200` → PNG جاهز (شارت MT5 أصلي مع الرسومات).
- `202` → ما زال الرسم/الرفع جارياً — أعد المحاولة بعد ثانيتين (حتى 5 مرات).
- `503` → EA غير متصل؛ إن وُجد `/api/agent/chart/{id}` استخدمه كـ fallback أو أبلغ المشغّل.

بدون MT5 (fallback QuickChart):

```bash
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  -o /tmp/aichart-rec.png "$AICHART_API_URL{chart_url}"
```

**رموز الكريبتو على MT5:** المنصّة تحوّل تلقائياً `BTCUSDT` → `BTCUSD` (ورموز
مماثلة) حسب الرموز المُبلَّغة في heartbeat الـ EA. إن رجع
`mt5_unavailable_reason: symbol_unavailable_on_mt5` الرمز غير متوفر عند الوسيط.

الصورة تتضمن تلقائياً: شموع، صندوق هدف أخضر، صندوق وقف أحمر، ونسبة R/R.

أنواع الرسم المتاحة في `chart_drawings`:
`price_line` · `trend_line` · `forecast_path` · `channel` · `zone` ·
`fib_retracement` · `baseline` · `marker` · `histogram_band`
(كل نقطة: `{"barsAhead": عدد الشموع من آخر شمعة — 0 الآن وموجب مستقبلاً, "price": السعر}`)

**لجنة التداول:** يرجع `committee` — إن `riskOfficer.vote === reject` لا تفترض
تنفيذاً تلقائياً في وضع auto.

**رد صوتي** (عند طلب صريح «رد عليّ بصوت»):

```bash
POST /api/agent/notify/voice
{"text": "نص الرد بالعربية"}
```

## 5) شارت لحظي بدون توصية («وريني الشارت»)

```bash
POST /api/agent/chart/snapshot
{"symbol":"BTCUSDT","interval":"1h","chart_drawings":[...]}
```

- إن كان EA متصلاً: `202` + `chart_url` مثل `/api/agent/chart/snap_…/mt5` — نفس حلقة
  poll أعلاه.
- إن كان EA غير متصل: `200` PNG مباشرة (QuickChart).

## 6) عرض الصفقات المفتوحة

```bash
GET /api/agent/trades/open
```

يرجع `summary_ar` جاهزاً + `aichartTrades` + `brokerPositions.mt5` + `executionEnv`.

## 7) بيئة التنفيذ (ديمو / حقيقي)

```bash
GET /api/agent/execution/env
POST /api/agent/execution/env   {"preference":"demo"|"live"}
POST /api/agent/binance/connect {"apiKey":"…","apiSecret":"…","env":"testnet"|"prod"}
```

## 8) موافقة بأزرار تيليجرام

```bash
POST /api/agent/approval/request
{
  "symbol": "EURUSD", "side": "buy", "confidence": 70,
  "practice": true, "rationale": "تجربة قدرة الوكيل",
  "market": "forex"
}
GET /api/agent/approval/pending
POST /api/agent/approval/respond   {"intent_id":12,"action":"approve"|"reject"}
```

- **الافتراضي عند الحاجة لموافقة:** `approval/request` — يُرسل ✅/❌؛ لا تنتظر «وافق» نصياً.
- بعد ضغط الزر تنفّذ المنصة تلقائياً.

## 9) فتح صفقة (مباشر)

```bash
POST /api/agent/trade/open
{
  "symbol": "BTCUSDT", "side": "buy",
  "notional": 100,
  "confidence": 82, "rationale": "سبب الدخول",
  "approved_by_user": true,
  "practice": false
}
```

- `practice: true` — صفقة تجريبية بقواعد مخفّفة على الديمو.
- `approved_by_user: true` — أمر صريح جداً («نفّذ الآن») أو بعد زر الموافقة.

### فتح صفقة Futures (شورت + رافعة — Binance USDT-M)

```bash
POST /api/agent/trade/open
{
  "symbol": "BTCUSDT", "side": "sell",
  "notional": 50,
  "market_type": "futures", "leverage": 3,
  "stop_loss": 64200, "take_profit": 61500,
  "confidence": 78, "rationale": "كسر دعم + زخم هابط",
  "approved_by_user": true
}
```

- `side: "sell"` مع `market_type: "futures"` يفتح **شورت** حقيقي.
- `notional` = **الهامش** الذي تخاطر به؛ حجم المركز = الهامش × الرافعة.
- الهامش **معزول (ISOLATED)** دائماً — الخسارة القصوى = الهامش فقط.
- **وقف الخسارة إلزامي** في الفيوتشرز — الطلب بدونه يُرفض من Risk Guard.
- الرافعة محدودة بسقف الأدمن (`max_leverage_cap`) — الافتراضي من الإعدادات
  (`default_leverage`) إن لم تحدد.
- يتطلب تفعيل `futures_enabled` في إعدادات المستخدم — إن رُفض بـ «غير مفعّل»
  أبلغ المشغّل ليفعّله من الإعدادات.

## 9ب) مراكز Futures المفتوحة وتعديل SL/TP

```bash
GET /api/agent/futures/positions            # المراكز + سعر التصفية + PnL غير المحقق + الرصيد
GET /api/agent/futures/positions?symbol=BTCUSDT

POST /api/agent/futures/modify              # تعديل SL/TP على مركز مفتوح (MT5-style)
{"symbol":"BTCUSDT","stop_loss":64500,"take_profit":61000}

GET /api/agent/futures/orders?symbol=BTCUSDT       # الأوامر المعلقة
DELETE /api/agent/futures/orders                   # إلغاء أمر/كل الأوامر
{"symbol":"BTCUSDT","order_id":123}   # أو {"symbol":"BTCUSDT","all":true}
```

- راقب `liquidationPrice` في positions — إن اقترب السعر منه أبلغ المشغّل فوراً.
- `modify` يلغي أوامر الحماية القديمة ويعيد وضعها على المستويات الجديدة.

## 10) إغلاق صفقات

```bash
POST /api/agent/trade/close
{"trade_id": 45}        # صفقة واحدة (سبوت أو فيوتشرز — تلقائياً)
{"all": true}           # كل الصفقات (طوارئ)
```

إغلاق صفقة فيوتشرز يلغي أوامر SL/TP أولاً ثم يغلق المركز بأمر reduce-only.

## 11) وضع التداول وKill Switch

```bash
POST /api/agent/mode          {"mode":"auto"|"approval"|"direct"}
POST /api/agent/kill-switch   {"on":true,"scope":"user","close_open_trades":true}
```

## 12) تشخيص EA (فوركس) — قبل فتح صفقة

```bash
GET /api/agent/ea/diagnostics?symbol=EURUSD
```

يرجع: `online`, `symbols[]`, `hasSymbol`, `quotesOk`, `retcodeLegend`.
إن `hasSymbol: false` → لا تفتح صفقة؛ اطلب من المشغّل إضافة الرمز لـ Market Watch
بالاسم الدقيق.

راجع **`EA_TROUBLESHOOTING.md`** في workspace للتفاصيل.

## أخطاء شائعة

- `401` → التوكن خاطئ. `503` → الجسر غير مف��ّل على المنصة.
- `ok:false` مع reason من Risk Guard → قرار نهائي، أبلغ المشغّل.
- الفوركس: أضف `"market":"forex"` للنداءات — فقط بطلب صريح من المشغّل.
- **retcode 10016** → SL/TP مرفوض عند الوسيط (ليس «صيغة EA»). جرّب يدوياً بدون stops.
- **retcode 10026** → لا سعر حي (سوق مغلق / لا quotes) — ليس «رمز مرفوض من EA».
- **retcode 10019** → هامش غير كافٍ (رافعة/رصيد).
- «مواصفات الرمز غير متاحة» → الرمز غير في heartbeat أو EA offline؛ استدعِ diagnostics.
- **لا مرشحين في scan** → إشارة فنية ضعيفة فقط؛ `HEARTBEAT_OK` — لا تربط بـ EA.
- TRXUSDT مع `activeMarket=crypto` → Binance؛ لا تنتظر مواصفات MT5.
