# مجموعة القدرات الذكية (Intelligence Suite)

> **الحالة:** منفّذ + نُشر v29 على VPS  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/aichart_intelligence_suite_10d64cba.plan.md`](./originals/aichart_intelligence_suite_10d64cba.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| ذاكرة ما بعد الصفقة | pgvector + embeddings + `tradePostMortem` |
| لجنة وكلاء | `committee.ts` قبل التنفيذ |
| مركز القيادة | `/command` — heatmap, macro, memory |
| رد صوتي | `POST /api/agent/notify/voice`, transcribe |
| VPS | `CREATE EXTENSION vector`, build + pm2 |

## الهدف

أربع قدرات: تحليل ما بعد الإغلاق، لجنة قرار، لوحة قيادة بصرية، وصوت تيليجرام.

## قائمة مهام

- [x] phase0-graphify
- [x] memory-post-mortem
- [x] committee-gate
- [x] command-center-ui
- [x] voice-telegram
- [x] vps-deploy (pgvector + v29)
