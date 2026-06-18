# إصلاح التحليل وإشعارات تليجرام

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/fix_analysis_and_telegram_67f04518.plan.md`](./originals/fix_analysis_and_telegram_67f04518.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| بوابة إشعار موحّدة | `deliverSignal` + `evaluateDelivery` في `alerts.ts` — `{ delivered, reason, reasonAr }` |
| مسح عميق + تليجرام | إشعار مرحلتين في `opportunityScan.ts` (فرصة فنية + نتيجة wait/buy/sell) |
| `telegramSent` صادق | `marketAnalyze.ts` + `analyze/route.ts` — لا true إلا عند تسليم فعلي |
| إزالة إرسال مزدوج | `recommendationChart.ts` يعتمد على البوابة الموحّدة |
| واجهة التحليل | `MarketRecPanel` + `marketContext` + `analysisProfile` — F&G عام + snapshot لكل زوج |
| بطاقة المسح | `OpportunityScanCard` — عرض delivered/reason + ربط `alert_log` |

## السياق

«تحليل مختلط» و«مزاج السوق 9/100» كانا يظهران لكل الأزواج (تسمية profile + Fear & Greed عام). المسح العميق يكتشف فرصة فنية لكن الوكيل يسجّل `wait` فلا يُرسل تليجرام — مع مسارات إشعار متعارضة و`telegramSent` مضلّل.

## قائمة مهام

- [x] notify-pipeline
- [x] scan-telegram
- [x] fix-telegram-sent
- [x] analysis-ui
- [x] scan-ui-feedback
- [x] verify-e2e
