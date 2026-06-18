# تصحيح تشخيصات OpenClaw لأخطاء EA

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/openclaw_ea_diagnostics_2a45af7d.plan.md`](./originals/openclaw_ea_diagnostics_2a45af7d.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| دليل workspace | [`agent/workspace/EA_TROUBLESHOOTING.md`](../../agent/workspace/EA_TROUBLESHOOTING.md) |
| Bridge API | `GET /api/agent/ea/diagnostics?symbol=` |
| retcode عربي | `web/src/lib/brokers/mt5Retcode.ts` |
| إصلاح SL/TP | `mt5Stops.ts` — يقلّل 10016 |
| EA heartbeat | `stops_level`, `freeze_level` في v1.02+ |

## الهدف

منع الوكيل من خلط «Bridge معطّل» مع retcode MT5 (10016/10026) أو «لا مرشحين» مع انقطاع EA.

## قائمة مهام

- [x] ea-troubleshooting-doc
- [x] agents-skill-heartbeat
- [x] ea-diagnostics-api
- [x] mt5-retcode-stops
- [x] ea-heartbeat-levels
- [x] sync-workspace
