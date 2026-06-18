# Quote Staleness — تحقيق وإصلاح EURUSDm

> **الحالة:** منفّذ (v4.02 HTTP diagnostics: pending)  
> **التاريخ:** 2026-06  
> **EA:** v4.01  
> **النسخة الكاملة:** [`originals/quote_staleness_investigation_f9c9d21b.plan.md`](./originals/quote_staleness_investigation_f9c9d21b.plan.md)

---

## نتيجة التنفيذ

| المرحلة | النتيجة |
|---------|---------|
| توثيق heartbeat payload | CHANGELOG + تعليقات `BuildSymbols` |
| tick gap metrics | `eaLiveState` histogram |
| baseline script | `infra/tmp-test-quote-freshness.py` |
| EA v4.01 | `EventSetTimer(1)` + `FlushChartSymbolQuote` |
| deploy مرحلي | web → verify → EA compile |

## التشخيص

`quoteAgeMs` مرتفع لأن quotes من heartbeat ~30s وليس tick stream — الإصلاح EA-side.

## قائمة مهام

- [x] doc-heartbeat-payload
- [x] server-tick-metrics
- [x] verify-script-baseline
- [x] ea-timer-chart-flush
- [x] vps-deploy-phased
- [ ] ea-http-failure-diagnostics (v4.02 — اختياري)

## يرتبط بـ

- [mcp-legacy-tools-fix.md](./mcp-legacy-tools-fix.md) — forex snapshot (خارج نطاق staleness)
