# إكمال ما تبقى من اقتراحات AiChart

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/إكمال_الباقي_aichart_caf7b567.plan.md`](./originals/إكمال_الباقي_aichart_caf7b567.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| إعدادات التداول | `max_open_trades` + أهداف ربح/خسارة في `TradingCard` |
| مركز التنبيهات | `read_at` في `alert_log` + API + `NotificationPanel` في `AppHeader` |
| هدف بالدولار | migration + store + riskGuard + UI |
| إغلاق تلقائي | ربح صغير + دمج cron/monitor |
| OCO | `oco_order_list_id` + مزامنة إغلاق من Binance |
| Cron VPS | `infra/aichart.cron` + سكربت تحقق |
| onboarding | API اقتراح الوكيل للمبتدئ + `OnboardingClient` |
| توثيق | تحديث `SUGGESTIONS_FEASIBLE.md` + نشر |

## السياق

مبني على فحص الكود مقابل [`docs/SUGGESTIONS_FEASIBLE.md`](../SUGGESTIONS_FEASIBLE.md) — معظم الـ 14 بنداً كان منفّذاً؛ المتبقي: تنبيهات الهيدر، حقول ناقصة، OCO، cron، حوار المبتدئ.

## قائمة مهام

- [x] phase-a-settings
- [x] phase-a-notifications
- [x] phase-b-usd-goal
- [x] phase-b-auto-close
- [x] phase-b-oco-sync
- [x] phase-c-cron
- [x] phase-c-onboarding
- [x] phase-d-docs-deploy
