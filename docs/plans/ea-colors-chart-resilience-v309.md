# EA v3.09 — Colors + Chart Resilience

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/ea_color_and_chart_fix_0d519282.plan.md`](./originals/ea_color_and_chart_fix_0d519282.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| parser ألوان hex موثوق | `HexToColor` بدل `ParseHexColor` |
| مرونة بعد تغيير timeframe | `OnChartEvent(CHARTEVENT_CHART_CHANGE)` |
| fill objects | `ApplyFillStyle` + `OBJPROP_BACK` |
| EA v3.09 | CHANGELOG + compile + deploy |

## المشاكل

- ألوان `#RRGGBB` تتحول لأسود (parser خاطئ)
- EA يتوقف عن heartbeat بعد تغيير إطار الشارت

## قائمة مهام

- [x] hex-color-parser
- [x] on-chart-event
- [x] fill-back-helper
- [x] v309-docs-test
