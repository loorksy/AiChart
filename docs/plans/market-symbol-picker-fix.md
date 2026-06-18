# تحسين منتقي الأزواج وإصلاح الإطار الزمني

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/market_symbol_picker_fix_703d639a.plan.md`](./originals/market_symbol_picker_fix_703d639a.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| IntervalPicker | `pointer-events-auto` + portal للقائمة على الديسكتوب |
| SymbolPicker | بطاقات شبكية (2 موبايل / 6 ديسكتوب) + بحث داخل اللوحة |
| ChartOverlayToolbar | إزالة بحث الشارت + استبدال `<select>` بـ SymbolPicker |
| MarketClient | ربط SymbolPicker + جلب instruments عند فتح اللوحة |

## السياق

منتقي الإطار الزمني داخل `pointer-events-none` — النقرات تمر إلى الشارت. اختيار الزوج عبر `<select>` صغير بدل بطاقات.

## قائمة مهام

- [x] fix-interval-picker
- [x] create-symbol-picker
- [x] update-toolbar
- [x] wire-market-client
- [x] verify-build-ui
