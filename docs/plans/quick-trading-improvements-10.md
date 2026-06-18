# 10 تحسينات — مسار «دخول → صفقة → انتظار»

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/10_تحسينات_تداول_سريع_4b1fff3f.plan.md`](./originals/10_تحسينات_تداول_سريع_4b1fff3f.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| API المسح | `POST /api/opportunities/scan` + زر «ابحث عن صفقة» |
| إصلاح الشارت | `PriceChart` — ResizeObserver، fullscreen، فوركس |
| مسح متعدد | فصل مسح سريع عن تحليل Claude لأفضل مرشّحين |
| onboarding | مسار «خذ صفقة وانتظر» مع preset auto+delegate |
| لوحة انتظار | `WaitingRoom` — حالة المسح، صفقات، نوايا، TTL |
| توجيه الدخول | dashboard/trade بدل chat |
| أزرار الشارت | «مسح» منفصل عن «تحليل» |
| watchlist | قائمة مراقبة مخصصة في الإعدادات |
| موافقة سريعة | approve/reject + إعادة مسح + `validateOpportunity` |
| polling | مسح دوري أثناء الجلسة |
| لقطة شارت | إصلاح إرسال صورة مع التوصية (تليجرام + ويب) |

## قائمة مهام

- [x] scan-api
- [x] fix-chart
- [x] multi-pair
- [x] quick-onboarding
- [x] waiting-room
- [x] login-redirect
- [x] chart-scan-btn
- [x] watchlist
- [x] quick-approve
- [x] client-polling
- [x] fix-screenshot
