# مسار تنبؤي على الشارت + تليجرام قبول/رفض

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/forecast_chart_+_telegram_1d931e30.plan.md`](./originals/forecast_chart_+_telegram_1d931e30.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| رسومات التنبؤ | `chart_drawings_json` + `ChartDrawingEngine` — W/M، هبوط/صعود، opacity حسب الثقة |
| الوكيل | `record_recommendation` + `chart_drawings[]` + قواعد الثقة |
| تليجرام | `processRecommendations` من `market/analyze` + `telegramIntentFlow` |
| بطاقة الموافقة | `approvalCard` + toast + خطوة مبلغ USDT |
| سياق التحليل | `analysisProfile` + `marketContext` + أداة `get_market_context` |
| واجهة | `IntervalPicker` + إبقاء overlays عند إغلاق اللوحة على الموبايل |
| لقطة شارت | entry/SL/TP + المسار التنبؤي تُرسل مع التوصية |

## الهدف

رسم مسار تنبؤي على الشارت من تحليل AI، وربط زر «تحليل» بإرسال توصية تنفيذ على تليجرام مع قبول/رفض وتنفيذ Binance.

## قائمة مهام

- [x] db-forecast-json
- [x] agent-forecast-schema
- [x] chart-drawing-engine
- [x] chart-forecast-draw
- [x] analyze-telegram-intent
- [x] telegram-card-forecast
- [x] opportunity-revalidate
- [x] telegram-amount-step
- [x] chart-snapshot-overlays
- [x] interval-analysis-profile
- [x] agent-market-context-tool
- [x] interval-picker-ui
- [x] mobile-close-keep-layers
- [x] verify-build
