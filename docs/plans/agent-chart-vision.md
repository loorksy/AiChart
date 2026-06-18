# تحليل بالرؤية — الوكيل يرى الشارت

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/agent_chart_vision_4f24bc41.plan.md`](./originals/agent_chart_vision_4f24bc41.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| التقاط من المتصفح | `PriceChart.capturePng()` — `forwardRef` + دمج canvases |
| إرسال الصورة | `MarketClient` يرسل `image` قبل التحليل ولا يمسح الطبقات مبكراً |
| احتياطي خادم | `buildChartSnapshotBufferForMarket` — crypto + forex عبر EA |
| وضع الوكيل | `runAgent` mode `chart_analyze` — أدوات محدودة، `MAX_STEPS=2` |
| persona | `chartAnalyzeSystemSuffix()` في `persona.ts` |
| UX | `MarketRecPanel`: مصدر الرؤية + `AgentActivityFeed` + toast |
| الحصة | `MARKET_ANALYZE_COST = 4` |

## الهدف

استبدال دورة أدوات `get_market_snapshot` (1–6 خطوات) بتحليل بصري: صورة الشارت + ملخص مختصر → الوكيل يرى ما يراه المستخدم.

## قائمة مهام

- [x] chart-capture-ui
- [x] analyze-api-vision
- [x] agent-chart-mode
- [x] quota-verify
