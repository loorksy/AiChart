# ربط التحليل والتوصية بالعملة والوقت

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/تحليل_حسب_الزوج_والوقت_c4291153.plan.md`](./originals/تحليل_حسب_الزوج_والوقت_c4291153.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| إعداد الإطار | `analysis_interval` في `trading_settings` + UI |
| API المسح | `opportunityScan` + `/api/opportunities/scan` — symbol, interval, market, focusOnly |
| مسح الشارت | زر مسح يربط بالزوج/الإطار/السوق الحالي |
| اللوحة | `OpportunityScanCard` + `WaitingRoom` polling بـ `analysis_interval` |
| عرض النتائج | الرمز والإطار في نتائج المسح ولوحة الانتظار |
| فوركس | دعم مسح فوركس في `runOpportunityScan` عند `market=forex` |

## السياق

زر «تحليل» كان يتبع الزوج والإطار، لكن مسح/«ابحث عن صفقة» ثابت على `1h` وwatchlist عامة.

## قائمة مهام

- [x] analysis-interval-setting
- [x] scan-api-context
- [x] chart-scan-context
- [x] dashboard-scan-context
- [x] scan-results-ui
- [x] forex-scan-optional
