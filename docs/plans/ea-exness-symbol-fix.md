# EA Exness Symbol Fix — EURUSDm vs EURUSDM

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **EA:** v3.05  
> **النسخة الكاملة:** [`originals/ea_exness_symbol_fix_c3fe8a9f.plan.md`](./originals/ea_exness_symbol_fix_c3fe8a9f.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| case-preserving symbols | `mt5SymbolMap.ts`, `forexCanonicalKey` |
| forex لا uppercase | `markets/resolve.ts`, `trade/open` |
| EA diagnostics | v3.05 — `LogAvailableSymbols`, `IsSymbolValid` |
| توثيق Exness suffix | `EA_TROUBLESHOOTING.md`, CHANGELOG |

## السبب الجذري

تحويل الرموز إلى uppercase في **الجسر (web)** — Exness يستخدم لاحقة `m` صغيرة.

## قائمة مهام

- [x] fix-mt5-symbol-map
- [x] fix-trade-open-forex
- [x] fix-resolve-forex
- [x] ea-v305-diagnostics
- [x] docs-changelog
- [x] compile-test-exness
