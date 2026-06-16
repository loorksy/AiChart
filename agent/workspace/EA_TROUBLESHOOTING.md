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
| 10026 | OFF_QUOTES — لا tick حي أو سعر غير مقبول لحظ الإرسال | **لا تفترض إغلاق السوق**؛ تحقق Market Watch و`quoteAgeMs`؛ إن quotes حية → Instant Execution / filling (EA v3.01+) |
| 10019 | NO_MONEY — هامش غير كافٍ | رصيد/رافعة/حجم لوت — هنا فقط تُذكر الرافعة |
| 10014 | INVALID_VOLUME | حجم لوت خاطئ |
| 10015 | INVALID_PRICE | سعر غير صالح |

إن ظهر `symbol not found` (ليس retcode) → اسم الرمز لا يطابق MT5 **حرفياً** (حالة الأحرف مهمة).

## Exness / suffix case (`EURUSDm`)

بعض الوسطاء (Exness، Pepperstone، …) يستخدمون لاحقات **حساسة لحالة الأحرف**:
- صحيح: `EURUSDm`, `GBPUSDm`, `XAUUSDm`
- خطأ: `EURUSDM`, `GBPUSDM` — MT5 يرفض `SymbolSelect`

**الجسر (web):** `resolveMt5Symbol` يرجع الاسم **كما في heartbeat**؛ `EURUSD` من الوكيل يُطابق `EURUSDm` تلقائياً.

**تشخيص:**
```bash
GET /api/agent/ea/diagnostics?symbol=EURUSDm   # hasSymbol, quotesOk
GET /api/agent/ea/query-terminal               # ea_version >= 3.05
```

**Experts tab (v3.05+):** `Market Watch symbols: EURUSDm, GBPUSDm, …` عند attach.

**EA v3.06+:** `ResolveBrokerSymbol()` — إن وصل الجسر `EURUSDM` يُحوَّل تلقائياً إلى `EURUSDm` من Market Watch (بدون `StringToUpper`).

إن ack يحتوي `symbol not found: EURUSDM` → deploy web + reattach EA v3.06+.

## تغيير الإطار الزمني / الرمز (AutoTrading)

عند تغيير H1→M15 أو رمز الشارت يدوياً، MT5 يعطّل **AutoTrading** تلقائياً:
- رسالة: `Automated Trading disabled because chart symbol or period has been changed`
- **EA v3.09+** يبقى حياً: heartbeat + أوامر الرسم (`draw_and_capture`) تعمل
- **الصفقات** تحتاج إعادة تفعيل زر AutoTrading يدوياً في MT5
- Experts tab: `AiChartBridge: chart symbol/period changed — re-enable AutoTrading if disabled.`
- **EA v3.10+:** `EventSetTimer(30)` keepalive — يُعاد تفعيله بعد تغيير الشارت؛ poll/heartbeat على `OnTick` أيضاً
- **لا** يستدعي EA `ChartSetSymbolPeriod` — إحداثيات الرسم عبر `iTime(sym, tf, offset)` فقط

## AutoTrading disabled by server (retcode 10026)

بعض حسابات demo/live تمنع EA من السير-side رغم زر AutoTrading الأخضر محلياً.
- Experts: `AutoTrading disabled by server`
- الحل: حساب/وسيط آخر، أو تفعيل algo trading من Liirat/Exness support — ليس bug في AiChart.

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
- الحل: تأكد EA **v3.01+**، الرمز في Market Watch، `quoteAgeMs < 5000` في `get_live_account`.

## 10026 مع quotes حية (Instant Execution)

يحدث غالباً على وسطاء مثل Liirat عندما:
- `trade_execution` = **instant** (ليس market)
- الـ EA يمرّر `price=0` أو filling غير مدعوم

**تشخيص MCP:**
```bash
GET /api/agent/ea/diagnostics?symbol=EURUSD   # trade_execution, filling_mode في symbol spec
POST query_mt5_terminal                       # reference_symbol + trade_execution
```

**Experts tab (بعد v3.01):** سطر `AiChartBridge: ORDER market ... price=... filling=... execution=instant`

**إصلاح:** Compile EA v3.01 من `ea/mt5/AiChartBridge.mq5` → Reattach على الشارت.

## نموذج رد صحيح

> EA متصل (Liirat 116921). فشل التنفيذ: retcode **10016** = وقف خسارة/جني ربح غير مقبول عند الوسيط.
> الخطوة: افتح EURUSD يدوياً في MT5 **بدون SL/TP**. إن نجحت نضبط التوصية. إن فشلت تواصل مع Liirat.

## مسح الفرص (scan)

`POST /api/agent/market/scan` بدون مرشحين = **لا إشارة فنية كافية** → `HEARTBEAT_OK` فقط. لا تربط ذلك بـ EA.
