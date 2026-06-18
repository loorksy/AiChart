# إصلاح EA retcode 10026 — Instant Execution + Filling Mode

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **EA:** v3.01  
> **النسخة الكاملة:** [`originals/fix_ea_10026_orders_a77148de.plan.md`](./originals/fix_ea_10026_orders_a77148de.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| `ResolveFillingMode`, `ConfigureTradeForSymbol` | `AiChartBridge.mq5` |
| Instant Execution + tick price صريح | `TryMarketOrder` / `ExecuteMarket` |
| pending orders + retry 10026 | `ExecutePending` |
| diagnostics filling mode | heartbeat / QueryTerminal |
| توثيق | `EA_TROUBLESHOOTING.md`, `mt5Retcode.ts` |

## التشخيص

الاتصال والأسعار تعمل — المشكلة في **بناء `MqlTradeRequest`** (filling mode / execution type).

## قائمة مهام

- [x] ea-helpers
- [x] ea-market-fix
- [x] ea-pending-fix
- [x] ea-diagnostics
- [x] docs-retcode
- [x] verify-mt5
