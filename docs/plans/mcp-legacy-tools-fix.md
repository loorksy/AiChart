# إصلاح أدوات جسر الوكيل القديمة (Legacy Tools Fix)

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06-17  
> **الإصدار:** جسر الوكيل 1.1.1 · خبير ميتاتريدر 4.01 (بدون تغيير)  
> **النسخة الكاملة:** [`originals/mcp_legacy_tools_fix_6fe0f843.plan.md`](./originals/mcp_legacy_tools_fix_6fe0f843.plan.md)

---

## نتيجة التنفيذ (ملخص)

| البند | النتيجة |
|-------|---------|
| §1 لقطة فوركس موحّدة + high24h/low24h بالطابع الزمني | منفّذ — `forexSnapshot.ts`, `forex24h.ts`, `forexPrice.ts` |
| §2 `capture_mt5_chart` — انتظار 30 ثانية | منفّذ — `chartInline.ts`, `mt5.ts` |
| §3 `get_recommendation_chart` — رسالة 503 أوضح | منفّذ — `chart/[id]/route.ts` |
| اختبارات | 43/43 `npm run test:bridge` (محلي) |
| نشر VPS | tarball — ويب + جسر وكيل |

---

## السياق

اختبار جسر الوكيل v1.1.0 كشف مسارات legacy. **خارج النطاق:** quote-staleness، `get_forex_indicators`، idempotency، confidence 80%.

---

## 1) [عالي] `get_market_snapshot` + كل مسارات forex snapshot

### التشخيص — عدم تطابق الرمز

| المسار | الملف | نفس العلة؟ |
|--------|-------|------------|
| MCP `get_market_snapshot` | `web/src/lib/markets/index.ts` | **نعم** |
| تحليل السوق (LLM) | `web/src/lib/marketAnalyze.ts` | **نعم** |
| مراقبة 24/7 | `web/src/lib/monitor.ts` | **نعم** |
| cron monitor | `web/src/lib/monitorRunner.ts` | **نعم** |
| API scan | `web/src/app/api/agent/market/scan/route.ts` | **نعم** |
| تقييم صفقة مفتوحة | `web/src/app/api/agent/trade/evaluate/route.ts` | **نعم** |
| agent.ts | `web/src/lib/agent.ts` | **نعم** |

**لا يوجد مسار forex snapshot «سليم» منفصل** — كل المسارات كانت على `buildForexSnapshot` القديم.

### عيب `high24h` / `low24h` = 24 شمعة وليس 24 ساعة

| الفريم | `slice(-24)` يعني | صحيح لـ 24h؟ |
|--------|-------------------|--------------|
| 1h | 24 ساعة | نعم (تقريباً) |
| 4h | 4 أيام | **لا** |
| 1d | 24 يوم | **لا** |

### قرار التصميم — لا thin wrapper

إعادة كتابة `buildForexSnapshot` لاستخدام pipeline موحّد:

- `fetchOhlc` + `resolveMt5Symbol`
- `computeForexIndicators`
- `getForexLiveMid` / `resolveLiveForexMid`
- `computeForex24hRange` (طابع زمني 86400000ms؛ fetch 1h إضافي عند interval > 1h)

### ملفات التعديل

| ملف | التغيير |
|-----|---------|
| `web/src/lib/markets/forexSnapshot.ts` | **جديد** — pipeline موحّد |
| `web/src/lib/markets/forex24h.ts` | **جديد** — `computeForex24hRange` |
| `web/src/lib/markets/forexPrice.ts` | **جديد** — سعر حي mid |
| `web/src/lib/market.ts` | re-export؛ إزالة مسار forex legacy |
| `web/src/lib/monitorRunner.ts` | `forexScanReady` عبر `resolveMt5Symbol` / `forexCanonicalKey` |
| `web/src/lib/markets/__tests__/forex24h.test.ts` | اختبارات |

**Regression crypto:** `buildSnapshot` + Binance — **بدون لمس**.

---

## 2) [متوسط] `capture_mt5_chart`

- Poll 30s لـ `draw_and_capture` في `mcp/src/tools/mt5.ts`
- تفويض اختياري → `capture_chart_snapshot`
- توثيق `mt5Schemas.ts` + `agent/workspace/AGENTS.md`

---

## 3) [منخفض] `get_recommendation_chart`

- رسالة 503 أوضح في `web/src/app/api/agent/chart/[id]/route.ts` (`reason`, `hint`)
- poll `/mt5` عند `chart_image_url` ينتهي بـ `/mt5`

---

## ترتيب التنفيذ (كما نُفّذ)

1. §1 — forex snapshot + 24h timestamp + `forexScanReady` + tests
2. §2 — capture poll + docs
3. §3 — rec chart errors
4. Deploy web + mcp + smoke

---

## قائمة مهام (من الخطة الأصلية)

- [x] fix-snapshot-forex
- [x] test-snapshot-forex
- [x] fix-capture-mt5-poll
- [x] fix-rec-chart-errors
- [x] deploy-mcp-legacy-fix
