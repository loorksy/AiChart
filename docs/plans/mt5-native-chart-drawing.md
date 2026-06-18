# الرسم على شارت MT5 الأصلي

> **الحالة:** منفّذ (ea-deploy-test: pending على Windows)  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/mt5_native_chart_drawing_579baba6.plan.md`](./originals/mt5_native_chart_drawing_579baba6.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| عقد EA | `draw_and_capture`, `clear_chart` في api-contract |
| MQ5 | رسم + `ChartScreenShot` + رفع PNG |
| API | `POST /api/ea/chart-upload` |
| Agent | `GET /api/agent/chart/[id]/mt5` (poll حتى 200) |
| كريبتو MT5 | `BTCUSDT` → `BTCUSD` عبر heartbeat |

## الهدف

لقطات شارت **من MT5 الحقيقي** بدل QuickChart — للفوركس والكريبتو على رموز الوسيط.

## قائمة مهام

- [x] ea-contract-draw
- [x] mq5-draw-screenshot
- [x] api-chart-upload
- [x] server-queue-mt5
- [x] agent-chart-mt5-endpoint
- [x] crypto-symbol-map
- [ ] ea-deploy-test (Compile على Windows)
