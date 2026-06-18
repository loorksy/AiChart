# EA MT5 v2 Fix — AiChartBridge v2.0

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/ea_mt5_v2_fix_c924be9e.plan.md`](./originals/ea_mt5_v2_fix_c924be9e.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| EA v2 — dual timers + poll commands | `ea/mt5/AiChartBridge.mq5` |
| heartbeat timeout 90s | `eaStore.ts` |
| close/modify mt_ea | `tradeClose`, `modify_sl_tp`, kill-switch |
| position sync | `eaPositionSync.ts`, `eaCommandWait.ts` |
| توثيق | `ea/mt5/CHANGELOG.md`, `api-contract.json` |

## المشاكل التي أُصلحت

- Offline / heartbeat صامت
- retcode 10026/10027 بدون retry
- صفقات MT5 غير مسجّلة في `trades`
- `adjust_sl` لا يُطبَّق على EA
- Kill Switch يتجاهل `mt_ea`
- صفقات بدون SL

## قائمة مهام

- [x] backend-ea-wait-sync
- [x] backend-trade-close-modify
- [x] backend-kill-switch-flags
- [x] ea-v2-core
- [x] docs-changelog
- [x] graphify-update
