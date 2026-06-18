# إصلاح واجهة السوق وقائمة الموبايل

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/market_ui_+_mobile_drawer_a5e8b208.plan.md`](./originals/market_ui_+_mobile_drawer_a5e8b208.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| MobileDrawer RTL | `start-0` + حركة من اليمين + scroll lock + a11y |
| شريط السعر | `MarketTickerBar` — سعر حي + 24h change من `/api/market/tickers` |
| تخطيط السوق | `MarketClient` — chart-first + segmented intervals + إزالة overlay العلوي |
| لوحة التوصية | `MarketRecPanel` — sidebar desktop + bottom sheet mobile |

## السياق

لوحة التوصية كانت تغطي أعلى الشارت. قائمة الموبايل تفتح من اليسار في RTL (`end-0` بدل `start-0`).

## قائمة مهام

- [x] fix-mobile-drawer-rtl
- [x] market-ticker-bar
- [x] market-layout-restructure
- [x] market-rec-panel
- [x] verify-build-deploy
