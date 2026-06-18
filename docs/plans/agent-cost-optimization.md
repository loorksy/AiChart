# تحسين تكلفة وكيل OpenClaw (Event-Driven)

> **الحالة:** منفّذ + نُشر (`3b92b23`)  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/agent_cost_optimization_3c73d874.plan.md`](./originals/agent_cost_optimization_3c73d874.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| Heartbeat AI | معطّل — لا مسح دوري كل 15د |
| Event monitor | `POST /api/cron/event-monitor` كل 10د |
| `monitorRunner.ts` | أحداث: trade_alert, daily_memory, … |
| Prompt caching | `cacheRetention: long` في sync-model |
| توفير متوقع | ~96 → 5–15 نداء AI/يوم |

## الهدف

استبدال نبض OpenClaw المكلف بمراقبة event-driven عبر كron المنصة.

## قائمة مهام

- [x] audit-heartbeat-vs-monitor
- [x] disable-openclaw-heartbeat-tasks
- [x] event-monitor-cron
- [x] monitor-runner
- [x] prompt-cache-sync
- [x] vps-deploy-verify
