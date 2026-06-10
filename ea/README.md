# AiChart MetaTrader EA Bridge

جسر يربط حساب **MetaTrader 4 / 5** بمنصة **AiChart** عبر API ذاتي الاستضافة —
بديل عن MetaApi، مناسب حيث لا تتوفر الخدمات السحابية (مثل سوريا).

- لا خدمة طرف ثالث، لا KYC، لا اشتراك خارجي.
- الاتصال **صادر** من MetaTrader إلى سيرفر AiChart فقط.
- التنفيذ يمر دائماً عبر **Risk Guard** في AiChart قبل أن يصل أمر إلى MT.

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
4. **MT4 فقط:** أضف رابط AiChart في
   `Tools → Options → Expert Advisors → Allow WebRequest for listed URL`.
5. فعّل **AutoTrading** (الزر الأخضر).

عند نجاح الاتصال ستظهر الحالة **online** في صفحة الإعدادات وفي شارة السوق.

راجع التفاصيل الكاملة في [`docs/EA_BRIDGE.md`](../docs/EA_BRIDGE.md).
