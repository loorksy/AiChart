# مركز الجسر الموحّد — Admin + Platform

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/unified_bridge_console_ea489b81.plan.md`](./originals/unified_bridge_console_ea489b81.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| Shell | `BridgeShell` + `bridgeNav` + layout `/console` responsive |
| نظرة عامة | صفحة overview + `ActiveTradesTable` (Binance/MT5/Futures) |
| دمج الإعدادات | تفكيك Settings/admin إلى `bridge/sections` + `InfoTip` |
| redirects | من `/admin` `/dashboard` `/settings` `/chat` `/market` `/agent` |
| لقطة Binance | `binanceChartCapture` Playwright + `/api/agent/chart/binance-capture` |

## الهدف

دمج لوحة الأدمن وواجهة المنصة في «مركز جسر» واحد (OpenClaw ↔ Binance/MT5) بدون وكيل/شارت داخل الويب.

## قائمة مهام

- [x] bridge-shell
- [x] overview-trades
- [x] merge-sections
- [x] redirects
- [x] playwright-capture
- [x] docs-qa
