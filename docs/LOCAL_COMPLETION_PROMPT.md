# برومبت الإكمال المحلي — انسخه كاملاً إلى محادثة Claude Code المحلية

> هذا الملف جزء من الفرع `claude/aichart-reliability-plan-pf8tv3`. انسخ ما بين السطرين الفاصلين إلى محادثة Claude Code تعمل محلياً على جهازك (حيث تتوفر مفاتيح OANDA/LLM وجسر MT5 وبيئة تشغيل كاملة).

---

أنت تعمل على مستودع AiChart محلياً. اسحب الفرع `claude/aichart-reliability-plan-pf8tv3` وابدأ منه.

## ما أُنجز مسبقاً (لا تعد تنفيذه)

1. **خطة التطوير** في `docs/RELIABILITY_PLAN.md` — اقرأها كاملة أولاً؛ هي المرجع الحاكم لكل ما يلي.
2. **المرحلة 0 منفذة وملتزمة** (commit بعنوان "Phase 0: three-state result envelope..."):
   - `web/src/lib/agent/resultEnvelope.ts` — عقد الحالات الثلاث (`execution_validated` / `descriptive_only` / `operational_blocker`) مع `execution_mode` و`trace_id` و`failure_stage/code`.
   - `web/src/lib/agent/errorTaxonomy.ts` — تصنيف الأخطاء المعمّم مع فصل رسالة المستخدم عن تفاصيل المشغّل.
   - `orchestrator.ts` — سجل أعطال مصنّف لكل مرحلة (`captureStage`) بدل `.catch(() => null)`، وenvelope على كل مسار إرجاع.
   - `chat/stream/route.ts` — حدث `final` كامل مضمون حتى عند الانهيار (SLO المرحلة 0)، ولا تسريب لرسائل الخطأ الخام.
   - `market/analyze/route.ts` + `analysisAccounting.ts` — لا خصم رصيد عند `operational_blocker`، و`applied_to_chart` صادق، و`recommendation_reason` لكل null.
   - اختبارات جديدة خضراء، وكل حِزم `npm run test:ci` خضراء وقت التسليم.

## الحواجز الصارمة (من `docs/RELIABILITY_PLAN.md` قسم «ما لا يجب تغييره»)

لا تلمس أياً من: حد 100 صفقة، bootstrap، walk-forward، سلطة النموذج الحصرية على BUY/SELL/WAIT، اشتراط التأكيد الصريح للتنفيذ، عدم اختراع بيانات سوق، عدم كشف chain-of-thought، الـDSL المغلق (لا كود حر). أي رد وصفي يبقى بلا أرقام تنفيذية.

## المطلوب منك بالترتيب

### أ. التحقق المحلي مما نُفّذ عن بُعد (لا يمكن التحقق منه بدون بيئة حية)

1. شغّل المنصة كاملة (web + مفاتيح LLM/OANDA حقيقية) ونفّذ سيناريوهات دخانية:
   - طلب تحليل ناجح → تحقق أن `envelope.outcome_class = descriptive_only` يصل في حدث `final` عبر SSE وفي رد `run_market_analysis`.
   - افصل مفتاح LLM مؤقتاً → تحقق: يصل `final` كامل بـ`operational_blocker` + `failure_code: auth/configuration`، **ولا يُخصم رصيد**، ويظهر `trace_id`.
   - افصل الشبكة عن OANDA مؤقتاً → تحقق `failure_stage: market_data` مع `retryable: true`.
   - ألغِ الطلب من المتصفح منتصف التحليل → تحقق ألا يبقى slot محجوزاً (طلب جديد يعمل فوراً).
2. تحقق من أداة MCP `run_market_analysis` من عميل MCP حقيقي: الحقول الجديدة (`envelope`, `recommendation_reason`, `applied_to_chart` قد تكون `false`) يجب ألا تكسر الـschema أو الواجهة. إن وجدت zod صارماً في `mcp/src/tools/charts.ts` يرفضها، أضف الحقول للـschema بدل إزالتها من الرد.
3. شغّل `cd web && npm run test:ci` محلياً وأكد بقاءه أخضر في بيئتك.

### ب. إكمال بنود المرحلة 0 المتبقية (تحتاج تحققاً بصرياً)

4. **شارة وضع التنفيذ في الواجهة**: ابنِ مكوّن badge يقرأ `envelope.execution_mode` و`envelope.outcome_class` ويعرض بشكل دائم فوق رد الوكيل: «تحليل وصفي — غير مخوّل للتنفيذ» / «Shadow» / «Demo» / «Live»، وبطاقة عطل واضحة عند `operational_blocker` تعرض السبب المبسّط و`trace_id`. الأماكن المرشحة: مكوّن عرض النتيجة في `web/src/components/agent/` والـreducer في `web/src/hooks/agentChatReducer` أو `useSmartChartAgent.ts`. تحقق بصرياً في المتصفح بالحالتين العربية والإنجليزية (RTL).
5. **معالجة حدث `final` الجديد في العميل**: مسار الفشل الآن يرسل `final` كامل ثم `error` — تأكد أن الواجهة لا تعرض الرسالتين معاً بشكل مكرر، وأن العميل القديم لا ينكسر.

### ج. المرحلة 1 من الخطة (اقرأ بنودها 2، 5، 6، 15 في `docs/RELIABILITY_PLAN.md`)

6. **Timeout hierarchy وإلغاء حقيقي**: مرّر `AbortSignal` من الـroute حتى كل استدعاء provider/LLM، بميزانية إجمالية أقل من مهلة MCP (150 ثانية)، وألغِ فعلياً عند انتهاء كل مرحلة (حالياً `withTimeout` يترك العملية تعمل خلفياً). لا تحرر analyze slot قبل توقف الأعمال التابعة.
7. **Checkpoint لكل مرحلة**: احفظ نتائج المتخصصين المكتملة بحيث تعيد المحاولة القرار النهائي فقط دون إعادة كل المراحل.
8. **Dependency matrix والتدهور الوصفي**: فشل الأخبار/الرسم → استمرار مع إعلان النقص؛ فشل ما يخص التنفيذ فقط → `descriptive_only`؛ فشل السعر/السلامة → `operational_blocker` (الأساس موجود في `stageFailures` — ابنِ عليه).
9. **Resilience للمزودات**: backoff مع jitter، احترام `Retry-After`، circuit breaker، وthrottle لكل مزود (بند 6).
10. **فصل النموذج السريع/العميق** (بند 15): المتخصصون والأخبار على نموذج أسرع، القرار النهائي على الأقوى، مع قياس قبل/بعد.

### د. المرحلة 2 — خدمة الأبحاث Python (تحتاج بيئة Python محلية)

11. نفّذ بنود 3 و4 من الخطة: عزل الـbacktest في worker process قابل للقتل مع lease/heartbeat، وفصل فشل النقل عن فشل الوظيفة (`poll_interrupted`/`status_unknown`/`reconciling`). شغّل `pytest` في `research-service/` قبل وبعد، وأضف fault test: وظيفة لا تستجيب للإلغاء يجب أن تُقتل قسرياً دون تعليق health endpoint.

### هـ. بعد كل مرحلة

- شغّل حِزم الاختبارات ذات الصلة + `npm run lint`.
- التزم بكل مرحلة في commit منفصل واضح على نفس الفرع.
- حدّث `docs/RELIABILITY_PLAN.md` بوسم البنود المكتملة.

## ملاحظات تصحيح معروفة مسبقاً

- `package-lock.json` غير متزامن مع `package.json` على main (ينقصه `@emnapi/runtime`) — `npm ci` يفشل؛ استخدم `npm install` أو حدّث اللوك في commit مستقل.
- أخطاء `tsc` في `@/vendor/tradingview/charting_library` موجودة مسبقاً (مكتبة خاصة غير مضمنة) — ليست منك، تجاهلها أو رشّح الفحص لملفاتك.
- اختبارا `integrationBoundaries` يفحصان ترتيب الكود مصدرياً بعلامة `captureStage("structure", runStructureAgent` — إن أعدت هيكلة الـorchestrator حدّث العلامات.

ابدأ بقراءة `docs/RELIABILITY_PLAN.md` ثم القسم (أ) أعلاه، ولا تنتقل لقسم قبل اكتمال الذي قبله واخضرار اختباراته.

---
