# تشخيص MetaTrader EA — لا تخمّن

اقرأ هذا الملف قبل أي تشخيص لفشل فوركس أو EA.

## قبل أي تشخيص

```bash
GET /api/agent/live/account           # بث موحّد MT5+Binance + quoteAgeMs
GET /api/agent/risk/status          # activeMarket: crypto | forex
GET /api/agent/portfolio            # forex.ea.online, account_login
GET /api/agent/ea/diagnostics?symbol=EURUSD   # الرموز من heartbeat
GET /api/agent/ea/live-quotes?symbol=EURUSD   # أسعار live من EA v3
```

## ممنوعات (لا تقلها للمشغّل)

- «Bridge API غير مكتمل» — الجسر يعمل إن كان EA **online**.
- «المنفذ 3010» — EA يتصل بـ `https://aichart.lork.cloud` فقط.
- «لا مرشحين في المسح = EA لا يرى فوركس» — المسح فحص **فني** على `allowed_assets`؛ لا علاقة له بheartbeat.
- «EA لا يقبل أي صيغة» — إن وُجد `retcode` فالرمز وُجد؛ الرفض من **MT5/الوسيط**.

## جدول retcode (MT5)

| retcode | المعنى | ماذا تقول |
|---------|--------|-----------|
| 10016 | INVALID_STOPS — SL/TP غير مقبول | وقف خسارة/جني ربح مرفوض؛ جرّب يدوياً **بدون SL/TP** |
| 10026 | OFF_QUOTES — لا tick حي لحظ التنفيذ | **لا تفترض إغلاق السوق**؛ تحقق Market Watch و`quoteAgeMs` |
| 10019 | NO_MONEY — هامش غير كافٍ | رصيد/رافعة/حجم لوت — هنا فقط تُذكر الرافعة |
| 10014 | INVALID_VOLUME | حجم لوت خاطئ |
| 10015 | INVALID_PRICE | سعر غير صالح |

إن ظهر `symbol not found` (ليس retcode) → اسم الرمز لا يطابق MT5 حرفياً.

## crypto vs forex

| الرمز | activeMarket=crypto | activeMarket=forex |
|-------|---------------------|---------------------|
| TRXUSDT, BTCUSDT | **Binance** | لا تستخدم MT5 إلا إن وُجد BTCUSD في diagnostics |
| EURUSD, GBPUSD | لا تُنفَّذ على MT5 | **MT5 EA** — الرمز في `diagnostics.symbols` |

رسالة «مواصفات الرمز غير متاحة بعد من MetaTrader» تعني: الرمز **غير موجود** في آخر heartbeat أو EA offline — لا تنتظر 30–60ث أكثر من مرة؛ تحقق من diagnostics.

## عند فشل صفقة فوركس

1. انقل `reason` من API **حرفياً**.
2. اسأل: «هل فتحت صفقة يدوية على نفس الرمز في MT5؟»
3. إن retcode 10016 ونجح اليدوي بدون SL/TP → المشكلة من مستويات التوصية (ليس الاتصال).
4. إن فشل اليدوي أيضاً → Liirat/الحساب/السوق — ليس AiChart.

## off quotes رغم تداول يدوي ناجح

- EA v3 يبث أسعار live كل 1–2ث عبر `POST /api/ea/quotes`.
- التحليل قد يقرأ **cache heartbeat** بينما التنفيذ يتحقق **لحظياً**.
- إن `quotesOk: true` في diagnostics **واليدوي ينجح** → **ممنوع** قول «السوق مغلق».
- الحل: تأكد EA v3، الرمز في Market Watch، `quoteAgeMs < 5000` في `get_live_account`.

## نموذج رد صحيح

> EA متصل (Liirat 116921). فشل التنفيذ: retcode **10016** = وقف خسارة/جني ربح غير مقبول عند الوسيط.
> الخطوة: افتح EURUSD يدوياً في MT5 **بدون SL/TP**. إن نجحت نضبط التوصية. إن فشلت تواصل مع Liirat.

## مسح الفرص (scan)

`POST /api/agent/market/scan` بدون مرشحين = **لا إشارة فنية كافية** → `HEARTBEAT_OK` فقط. لا تربط ذلك بـ EA.
