# جسر MetaTrader عبر EA (الفوركس) — التوثيق التقني

يشرح هذا المستند كيف يربط AiChart حسابات الفوركس (MT4/MT5) عبر **Expert Advisor**
بدل خدمة سحابية مثل MetaApi. التصميم مناسب للمناطق المحظورة (مثل سوريا) لأن
الاتصال صادر من MetaTrader فقط ولا يتطلب تسجيلاً عند طرف ثالث.

## المعمارية

```text
MetaTrader (المستخدم)              AiChart (سيرفر Linux)
  EA AiChartBridge   ──heartbeat──▶  POST /api/ea/heartbeat
                     ◀──commands───  (الأوامر المعلّقة في الرد)
                     ──ack────────▶  POST /api/ea/commands/{id}/ack
```

- **heartbeat** كل ثانيتين: يرسل الرصيد/الحقوق، مواصفات الرموز، وشموع الرمز النشط.
- الرد يتضمن **الأوامر المعلّقة**؛ ينفّذها EA فوراً ثم يرسل **ack**.
- بث الأسعار/الشموع يُخزَّن في `ea_market_cache` ويستخدمه شارت الفوركس.

## مسار التنفيذ عبر الوكيل

```text
الوكيل/المراقبة → توصية (market=forex)
   → createIntent (broker=mt_ea)
   → executeIntent → Risk Guard (نفس الحدود)
   → eaAdapter.placeOrder:
        - تأكد أن EA online (heartbeat حديث < 30s)
        - احسب اللوت من مواصفات الرمز (lotSizing)
        - أنشئ ea_command(open_market)
        - انتظر ack حتى 30s
        - سجّل الصفقة + حدّث حالة الـ intent
```

Risk Guard يبقى **السلطة الوحيدة**: لا يصل أمر إلى MT إلا بعد اجتياز كل الحدود.

## قاعدة البيانات

| الجدول | الغرض |
|--------|--------|
| `ea_connections` | اتصال MT لكل مستخدم (token_hash، platform، الحالة، آخر heartbeat، مواصفات الرموز) |
| `ea_commands` | طابور الأوامر (pending → sent → acked/failed/expired) |
| `ea_market_cache` | شموع الفوركس المخزّنة من EA |

أُضيف أيضاً:
- `trading_settings.active_market` (`crypto`\|`forex`)
- `trade_intents.market` / `trade_intents.broker`
- `trades.market` / `trades.broker`

## المصادقة

- يولّد المستخدم رمزاً من الإعدادات: `POST /api/ea/token` (يُعرض مرة واحدة).
- يُخزَّن **hash** فقط (`SHA-256`) في `ea_connections.token_hash`.
- يرسل EA الرمز في `Authorization: Bearer <token>` (أو `X-EA-Token`).

## نقاط الـ API

| Method | Path | المصادقة | الوصف |
|--------|------|----------|--------|
| POST | `/api/ea/token` | جلسة المستخدم | توليد/تدوير الرمز |
| GET | `/api/ea/token` | جلسة المستخدم | حالة الاتصال (غير سري) |
| DELETE | `/api/ea/token` | جلسة المستخدم | إلغاء الربط |
| GET | `/api/ea/status` | جلسة المستخدم | حالة الاتصال للواجهة |
| POST | `/api/ea/heartbeat` | رمز EA | نبضة + إرجاع الأوامر |
| GET | `/api/ea/commands` | رمز EA | جلب الأوامر المعلّقة |
| POST | `/api/ea/commands/{id}/ack` | رمز EA | تأكيد التنفيذ |

## تحويل حجم اللوت

`computeForexLots(notional, price, spec)` في
[`web/src/lib/brokers/lotSizing.ts`](../web/src/lib/brokers/lotSizing.ts):

- `valuePerLot ≈ contract_size × price`
- `lots = round(notional / valuePerLot, lot_step)` ضمن `[min_lot, max_lot]`
- إن غابت المواصفات → **رفض آمن** (لا يُرسل أمر غير محسوب).

## ملاحظات تشغيلية

- يجب أن يبقى MetaTrader مفتوحاً ومتصلاً (جهاز المستخدم أو VPS Windows خارج سوريا).
- إذا تأخّر heartbeat أكثر من 30 ثانية تُرفض الأوامر مع رسالة «MetaTrader غير متصل».
- الأوامر idempotent: يتذكّر EA آخر `command id` نُفّذ ولا يكرّره.
- **MT4** يتطلب إضافة رابط AiChart في إعدادات WebRequest.

## أمان

- لا صلاحية سحب — EA ينفّذ صفقات فقط.
- الرمز قابل للإلغاء فوراً من الإعدادات (DELETE).
- نفس فلسفة مفاتيح Binance: لا تُخزَّن أسرار بنص صريح.
