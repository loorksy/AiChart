# AiChart MetaTrader EA Bridge

جسر يربط حساب **MetaTrader 4 / 5** بمنصة **AiChart** عبر API ذاتي الاستضافة —
بديل عن MetaApi، مناسب حيث لا تتوفر الخدمات السحابية (مثل سوريا).

- لا خدمة طرف ثالث، لا KYC، لا اشتراك خارجي.
- الاتصال **صادر** من MetaTrader إلى سيرفر AiChart فقط.
- التنفيذ يمر دائماً عبر فحوص الأمان التقنية والموافقة الصريحة في AiChart قبل أن يصل أمر إلى MT.

## الملفات

| الملف | المنصّة |
|------|---------|
| [`mt5/AiChartBridge.mq5`](mt5/AiChartBridge.mq5) | MetaTrader 5 |
| [`mt4/AiChartBridge.mq4`](mt4/AiChartBridge.mq4) | MetaTrader 4 |
| [`shared/api-contract.json`](shared/api-contract.json) | عقد الـ API |

## التثبيت السريع

1. من AiChart: **الإعدادات → الربط والتكامل → MetaTrader** ثم ولّد **رمز الربط (Token)**.
2. انسخ ملف EA إلى مجلد `MQL5/Experts` (أو `MQL4/Experts`) ثم أعد تشغيل/ترجمة في MetaEditor.
3. اسحب `AiChartBridge` على أي شارت، واملأ:
   - `ApiBase` = `https://aichart.lork.cloud`
   - `EaToken` = الرمز من الخطوة 1
   - `StreamSymbol` = الزوج الذي تريد بثّه (مثل `EURUSD`)
4. أضف رابط AiChart في
   `Tools → Options → Expert Advisors → Allow WebRequest for listed URL`.
5. فعّل **AutoTrading** (الزر الأخضر).

### تفعيل دائم (مرة واحدة) — لا إعادة تفعيل عند تبديل الأزواج/الفريمات

في `Tools → Options → Expert Advisors` **ألغِ ✅** من:
`Disable algorithmic trading when the charts symbol or period has been changed`
(وكذلك خياري *account changed* و *profile changed*). هذا إعداد طرفية لا يمكن لأي
كود EA تجاوزه — إلغاؤه مرة واحدة يُبقي الجسر مفعّلاً عبر كل التبديلات. للتشغيل 24/7
استخدم **MetaQuotes Virtual Hosting** (انقر يميناً على الشارت → *Register a Virtual
Server* → *Migrate*).

منذ **v4.05** يعرض الـ EA **لوحة حالة** على الشارت (اتصال المنصة · حالة
AutoTrading · الحساب · البث) فتعرف فوراً إن كان الجسر حياً.

## EA v2.00 — إعدادات جديدة

| Input | الافتراضي | الغرض |
|-------|-----------|--------|
| `HeartbeatSeconds` | 30 | نبضة الحالة (رصيد، بوزيشنز، شموع) |
| `PollIntervalMs` | 1000 | استطلاع الأوامر عبر `GET /api/ea/commands` |
| `AllowNoSL` | false | رفض فتح صفقة بدون وقف خسارة |
| `MaxRetries` | 3 | إعادة المحاولة عند broker busy / requote |
| `RetryDelayMs` | 500 | الفاصل بين المحاولات |
| `AutoSync` | true | heartbeat فوري عند تغيير البوزيشن |

راجع [`mt5/CHANGELOG.md`](mt5/CHANGELOG.md) للتفاصيل.

عند نجاح الاتصال ستظهر الحالة **online** في صفحة الإعدادات وفي شارة السوق.

راجع عقد الجسر المشترك في [`ea/shared`](shared).

## إعادة الترجمة بعد تحديث الرسم على الشارت (v1.01+)

يتطلب مسار `draw_and_capture` إعادة compile الـ EA على **Windows + MetaEditor**:

### MetaTrader 5

1. انسخ [`mt5/AiChartBridge.mq5`](mt5/AiChartBridge.mq5) إلى
   `%APPDATA%\MetaQuotes\Terminal\<HASH>\MQL5\Experts\` (أو افتح الملف من
   MetaEditor مباشرة).
2. في MetaEditor: **Compile** (F7) — تأكد من عدم وجود أخطاء.
3. في MT5: أعد تحميل الـ EA على الشارت (أو أعد تشغيل المنصّة).
4. تأكد من **Allow WebRequest** لرابط AiChart في
   `Tools → Options → Expert Advisors`.
5. اختبر: أرسل توصية من الوكيل → راقب كائنات `AICHART_*` على الشارت → تحقق من
   وصول PNG عبر `GET /api/agent/chart/{id}/mt5`.

### MetaTrader 4

MT4 لا يدعم `draw_and_capture` في هذا الإصدار — يبقى التنفيذ والـ heartbeat فقط.

### اختبار end-to-end (EURUSD + BTCUSD)

1. `StreamSymbol` = `EURUSD`، EA **online** في إعدادات AiChart.
2. توصية وكيل `EURUSD` H1 مع `zone` + `trend_line` → poll `chart_url` حتى `200`.
3. كرّر بـ `BTCUSDT` إن كان `BTCUSD` (أو ما يعادله) في Market Watch.
4. أوقف EA → توصية جديدة يجب أن ترجع `chart_url` القديم (QuickChart fallback).
