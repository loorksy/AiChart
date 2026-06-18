# دمج MetaApi لتداول الفوركس

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/metaapi_forex_integration_256e8886.plan.md`](./originals/metaapi_forex_integration_256e8886.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| عميل MetaApi | `web/src/lib/metaapi/client.ts` — SDK + `isConfigured` |
| تخزين الحسابات | جدول `mt_accounts` + تشفير كلمة المرور |
| API الربط | `/api/mt/connect` + `/api/mt/status` — provision + deploy |
| محوّل التنفيذ | `metaApiAdapter.ts` + `FOREX_BACKEND` في `brokers/index.ts` |
| بيانات السوق | klines/forex-price/instruments عبر MetaApi عند `backend=metaapi` |
| واجهة موبايل | `MtConnectCard` — 3 حقول (login/password/server) في الإعدادات والـ onboarding |

## الهدف

ربط فوركس للمستخدم النهائي بـ 3 حقول فقط دون VPS أو EA — مع الإبقاء على جسر EA كبديل.

## قائمة مهام

- [x] metaapi-client
- [x] mt-store
- [x] mt-api
- [x] metaapi-adapter
- [x] forex-marketdata
- [x] mt-ui
- [x] agent-context-build
