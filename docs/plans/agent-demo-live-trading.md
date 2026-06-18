# ديمو/حقيقي + عرض الصفقات + موافقة تيليجرام

> **الحالة:** منفّذ + نُشر على VPS  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/agent_demo_live_trading_7eb01d10.plan.md`](./originals/agent_demo_live_trading_7eb01d10.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| `executionEnv` | `web/src/lib/executionEnv.ts` + `GET/POST /api/agent/execution/env` |
| صفقات مفتوحة | `GET /api/agent/trades/open` + `summary_ar` + مراكز MT5 |
| موافقة أزرار | `approval/request` + `GET /api/telegram/act` |
| practice | `practice:true` في approval + Risk Guard مخفّف للديمو |
| Binance | حسابان `(user_id, env)` testnet + prod |

## الهدف

الوكيل يعرف ديمو vs حقيقي، يعرض الصفقات عند الطلب، ويطلب موافقة بأزرار تيليجرام.

## قائمة مهام

- [x] execution-env-layer
- [x] trades-open-api
- [x] telegram-approval-buttons
- [x] practice-mode
- [x] agent-docs
- [x] vps-deploy
