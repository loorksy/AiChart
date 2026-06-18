# إعادة تصميم AiChart — مقاربة Tasawur

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/aichart_tasawur_redesign_9e73507c.plan.md`](./originals/aichart_tasawur_redesign_9e73507c.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| نظام التصميم | ثيم فاتح كريمي + داكن — `AppHeader`, `MobileDrawer`, `SurfaceCard` |
| تنقل موحّد | `AppShell` — 3 تبويبات + درج موحّد + شارة رصيد |
| المحادثة | `ChatSquareClient` — تحية بالاسم، pills، رصيد ظاهر |
| لوحة الحساب | Dashboard + Settings ببطاقات Tasawur-like |
| معالج إشارات | `/signals/new` — 4 خطوات + `/api/instruments` + `/api/signals/generate` |
| تبسيط | إزالة Finnhub، Binance فقط، تحديث persona وPLAN.md |

## قائمة مهام

- [x] design-system
- [x] unified-nav
- [x] chat-ux
- [x] dashboard-settings
- [x] signals-wizard
- [x] binance-only
