# وكيل تداول ذكي — بث حي وذاكرة وسياق

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/وكيل_تداول_ذكي_5ad4ca3a.plan.md`](./originals/وكيل_تداول_ذكي_5ad4ca3a.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| بث حي | `callAnthropicStream` + SSE delta في chat route |
| Square UI | مكوّنات Square + RTL + بث حيّ |
| ذاكرة المحادثة | جداول `conversations`/`chat_messages` + API |
| سياق المستخدم | `buildUserContext` + أدوات profile/trades + persona |
| أسواق متعددة | طبقة `markets/` — Binance + Finnhub (لاحقاً أُزيل Finnhub) |
| خارطة طريق | Telegram parity، Futures، i18n، PostgreSQL |

## الهدف

تحويل الوكيل من ردّ دفعة واحدة إلى وكيل ذكاء اصطناعي حقيقي: بث، ذاكرة، سياق حساب، واجهة Square.

## قائمة مهام

- [x] stream-api
- [x] square-ui
- [x] chat-memory
- [x] user-context
- [x] multi-market
- [x] global-roadmap
