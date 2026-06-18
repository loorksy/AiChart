# إكمال Binance Futures + أمان المفتاح

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/complete_futures_gaps_2612fbe1.plan.md`](./originals/complete_futures_gaps_2612fbe1.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| سقف المركز | `margin×leverage ≤ effectiveCapital` في `riskGuard.ts` |
| التحقق من Binance | `binanceVerify.ts` + `/api/binance/verify` + checklist في `BinanceCard` |
| صلاحيات Futures | رفض trade/open futures إن `enableFutures=false` على prod |
| تنبيه التصفية | `watchFuturesLiquidationProximity` + `monitorRunner` |
| أوامر Limit | `order_type`/`limit_price` + `syncFuturesLimitFills` + cron |

## السياق

إكمال فجوات PR #26 (smart-agent): Limit orders، verify، liquidation alerts، position cap.

## قائمة مهام

- [x] pull-main
- [x] risk-position-cap
- [x] binance-verify
- [x] block-futures-perms
- [x] liquidation-alerts
- [x] limit-orders
- [x] verify-build
