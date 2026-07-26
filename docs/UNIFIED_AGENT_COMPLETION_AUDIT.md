# مصفوفة اكتمال AiChart — كل مطلب تنفيذي، بحالته ودليله

> **الغرض**: تحويل كل مطلب في `UNIFIED_AGENT_IMPLEMENTATION_PLAN.md` إلى بند قابل للتحقق، بحالة مبنية على **فحص الكود الحالي** لا على تقرير سابق. عند التعارض بين تقرير وكود، الكود هو المرجع.
>
> **الحالات**: `implemented` (كود + اختبار) · `partial` (جوهر موجود وتفصيل ناقص) · `missing` (صفر تنفيذ) · `operational-only` (الكود كامل والتحقق يحتاج بيئة خارجية).
>
> **قاعدة الإعلان**: لا يُعلن الاكتمال قبل وجود دليل لكل بند. `partial` أو `missing` غير مقبولة إلا مع تفسير.

---

## أ) الأسلوب

كل حالة أدناه أُنتجت بأمر بحث فعلي على الشجرة (grep/glob على الرمز أو العمود أو المسار)، وليس من الذاكرة. البنود التي وجدتها ناقصة في التدقيق السابق (19 بنداً) مُدرجة أولاً، ثم بحثتُ من جديد عن نقص آخر لم يُذكر.

---

## ب) البنود التسعة عشر المكتشفة سابقاً

| # | المرحلة/القسم | المطلوب | الحالة قبل هذه المهمة | دليل الحالة |
|---|---|---|---|---|
| 1 | §5 | ثمانية أعلام مراحل | `missing` | صفر مرجع لكل من الثمانية في الشجرة |
| 2 | §9 D.2 | مبدّل الوضع + الشارة + لوحة الانتظار (واجهة) | `missing` | `git diff origin/main..HEAD` لا يمسّ أي `.tsx` |
| 3 | §8 C.4 | مركز إشعارات + بث SSE | `missing` | صفر `text/event-stream` في مسارات التنبيه |
| 4 | §15 J | صفحة دفتر الأداء (واجهة) | `missing` | لا مكوّن؛ المسار `/api/recommendations/journal` فقط |
| 5 | §7 B.9 + دستور §6 | محفزات إعادة التقييم | `missing` | صفر مرجع لأي رمز إعادة تقييم في `recommendations/` |
| 6 | §7 B.6 | حدث `retest_started` | `missing` | صفر مرجع |
| 7 | §7 B.6 | حدث `breakout_no_retest` | `missing` | صفر مرجع |
| 8 | §6 A (بيانات) | عمود `evidence_source` | `missing` | مرجع واحد فقط (نص الخطة) |
| 9 | §6 A.5 | `plan_type` إلزامي في MCP | `missing` | صفر مرجع في `coreSchemas.ts` |
| 10 | §11 F.2 | كاشف Rectangle | `missing` | صفر مرجع في `chart/geometry/` |
| 11 | §11 F.2 | كاشف Cup & Handle (وعكسه) | `missing` | صفر مرجع |
| 12 | §11 F.2 | كاشف Triple Top/Bottom | `missing` | صفر مرجع |
| 13 | §11 F.3 | مولّد مرشحات `pattern_boundary` | `missing` | صفر مرجع؛ الفرص تصل البرومبت لا `buildTradeCandidates` |
| 14 | §10 E | جولة الفريم الإضافي | `missing` | صفر مرجع |
| 15 | §13 H.1 | ملف تكلفة جلسي **حي** من عروض EA | `partial` | `SESSION_SPREAD_MULTIPLIER` مضاعِفات ثابتة، لا تجميع مرصود |
| 16 | §8 C.6 | إشعار اقتراب حدث اقتصادي | `missing` | صفر مرجع |
| 17 | §14 I | نسخة «إدارة صفقة» بعد الفتح | `missing` | صفر مرجع لنوع `trade_management` |
| 18 | §15 J | مولّد الملاحظات الشخصية | `missing` | صفر مرجع |
| 19 | §16 + معيار 2 | سجل اختلاف المنصة/MCP | `missing` | صفر مرجع |

---

## ج) نقص إضافي وجدته في هذه المهمة (لم يكن في الـ19)

| # | المرحلة/القسم | المطلوب | الحالة | دليل |
|---|---|---|---|---|
| 20 | §17 | لوحات القياس (13 مقياساً) | `missing` | صفر مرجع لـ hiddenWait/staleRevision/wrongMode في `metrics.ts` |
| 21 | §16 | عُدة سيناريوهات بشموع مسجلة + صور تشغّل المسارين | `partial` | 15 سيناريو صناعياً في `doctrineScenarios.test.ts`؛ لا fixtures ولا مسار MCP |
| 22 | §12 G | نتائج المراحل الجزئية في ذاكرة الحالات | `partial` | نتيجة واحدة لكل اتجاه؛ لا اكتمال/فشل النموذج ولا مبكر-مقابل-مؤكد |
| 23 | §12 G | pgvector للتشابه | `missing` | ترتيب في الذاكرة؛ صفر مرجع لـ vector في `pg.ts` |
| 24 | §20 معيار 12 | تمرين الإغلاق المعماري | `missing` | لم يُنفَّذ كتمرين |
| 25 | §6 A.7 | تحديث `AGENTS.md` بالعقيدة | `partial` | يحتاج تحقق نصي |
| 26 | §9 D.7 | `executed_by: auto\|manual_approval` | `partial` | مُخزَّن كـ`authorization_source`؛ الاسم يختلف عن الخطة |

---

## د) البنود المُنفَّذة والمُثبتة قبل هذه المهمة

مُدرجة للاكتمال، كل واحد بملفه واختباره. هذه لا تُلمس في هذه المهمة إلا إن كسرها تغيير.

| المرحلة | المطلوب | الملفات | الاختبار |
|---|---|---|---|
| A.1 | الدستور + parity | `agent/workspace/SYSTEM.md`, `canonicalIdentity.ts` | `canonicalIdentity.test.ts` |
| A.2 | عقد الطبقات الثلاث | `finalDecisionSynthesizer.ts`, `trading/tradePlan.ts` | `finalDecisionSynthesizer.test.ts`, `doctrineScenarios.test.ts` |
| A.3 | البرومبت | `finalDecisionSynthesizer.ts` (SYNTH_SYSTEM_PROMPT) | `doctrineGuard.test.ts` |
| A.4 | العائد الضعيف وسماً | `buildTradeCandidates.ts`, `scalpGeometry.ts` | `scalpGeometry.test.ts` |
| A.5 | 409 → وسم دعم | `api/agent/recommendation/route.ts`, `coreSchemas.ts` | `recommendationGate.test.ts` |
| A.6 | تنظيف WAIT + حارس نصي | متعدد | `doctrineGuard.test.ts` |
| A.8 | Decision Trace يُنتَج ويُوصَّل ويُخزَّن | `finalDecisionSynthesizer.ts`, `types.ts`, `orchestrator.ts` | `singleBrainGuard.test.ts`, `decisionDelivery.test.ts` |
| A.9 | حارس العقل الواحد | — | `singleBrainGuard.test.ts` |
| B.1–B.5 | النسخ + CAS + النسخة 1 | `canonical/revisions.ts`, `repository.ts`, `execution.ts` | `revisions.test.ts`, `decisionDelivery.test.ts` |
| B.8 | Evidence Snapshot | `canonical/revisions.ts` | `decisionDelivery.test.ts` |
| C.1–C.3 | أحداث + إشعار + منع تكرار + اقتراب | `lifecycleEvents.ts`, `lifecycleNotifier.ts` | `lifecycleEvents.test.ts`, `lifecycleNotifier.test.ts` |
| C.5 | قناة الدفع | `push.ts`, `api/alerts/push/route.ts`, `push-sw.js` | `operational-only` للمتصفح |
| D.1,3,4 | وضع مشترك + أداة MCP + الهبوط | `agent/tradeMode.ts`, `api/agent/trade-mode/route.ts` | `tradeMode.test.ts` |
| D.5,6 | محرك تلقائي + مصدران | `autoExecutor.ts`, `execution.ts` | `executionAuthorizationPaths.test.ts` |
| E | الرؤية + أدوار الفريمات | `visualEvidence.ts`, `finalDecisionSynthesizer.ts` | `evidenceBundleImmutability.test.ts` |
| F.1 | Pattern Atlas | `agent/workspace/skills/pattern-atlas/` | `skillIntelligentSelection.test.ts` |
| F.2 (جزء) | الشموع + المراحل الثماني | `candlesticks.ts`, `patternStage.ts` | `candlesticks.test.ts`, `geometry.test.ts` |
| G (جوهر) | ذاكرة الحالات + عدم التسريب | `marketMemory/*` | `caseMemory.test.ts`, `caseIndexerDb.test.ts` |
| H.4 | وصول الدعم الإحصائي | `strategies/supportSummary.ts` | `evidenceBundleImmutability.test.ts` |
| I (جوهر) | البحث العميق → نسخة | `deepAnalysis/completion.ts` | `singleBrainGuard.test.ts` |
| J (جوهر) | دفتر الأداء + إصلاح الدروس | `performanceJournal.ts`, `orchestrator.ts` | `journalQuery.test.ts`, `performanceJournal.test.ts` |
| دستور 0-ب | نقاء الحزمة | — | `evidenceBundleImmutability.test.ts` |
| دستور 9 | لا قرار خارج العقل | — | `singleBrainGuard.test.ts` |

---

## هـ) ما هو `operational-only` بطبيعته

هذه لا يمكن إثباتها في السحابة مهما كان الكود صحيحاً. تُدرج في قائمة التحقق التشغيلية لا في «ناقص».

| البند | لماذا |
|---|---|
| هجرة PostgreSQL على قاعدة حقيقية | لا Postgres في البيئة |
| فهرس pgvector الفعلي | يحتاج إضافة `vector` على خادم حقيقي |
| Redis الحقيقي | اختبار واحد متخطى |
| MT5 / EA / وسيط / سوق حي | لا جسر |
| تيليجرام الحقيقي | لا رمز بوت |
| Push في متصفح + Service Worker | لا متصفح مع أذونات |
| SSL / reverse proxy / cron على VPS | خارج البيئة |
| `npm run build` كاملاً | يحتاج سرّ ترخيص TradingView |
| dry-run / demo / live | يحتاج حساباً |

---

## و) سجل التنفيذ في هذه المهمة

يُحدَّث مع كل مجموعة تغييرات مُودَعة. العمود الأخير هو الدليل النهائي.

| البند | ما تغيّر | الحالة النهائية | الدليل |
|---|---|---|---|
| 1 — أعلام المراحل | أُضيفت الثمانية + علم محفزات إعادة التقييم؛ كل علم **يُقرأ فعلاً** عند نقطة عمل مرحلته، وقائمة `PHASE_FLAGS` تُلزم وجود علم لكل مرحلة A–J | `implemented` | `featureFlags.ts`؛ `phaseFlags.test.ts` (18 اختباراً: ON/OFF لكل علم، وجود قارئ، عدم كسر القراءة عند OFF، توثيق في env) |
| 9 — `plan_type` إلزامي في MCP | إلزامي في عضوَي الاتحاد المميَّز وفي شكل الكتالوج؛ ومُضاف للمسار الخادمي ومُخزَّن | `implemented` | `coreSchemas.ts`؛ `recommendationGate.test.ts` (يرفض بلا نوع، يقبل الثلاثة)؛ `api/agent/recommendation/route.ts` |
| 8 — `evidence_source` | عمود nullable إضافي في SQLite وPG + هجرة إضافية + عقد الإنشاء | `implemented` (المخطط والعقد) · `partial` (لم يُملأ من المسارات بعد) | `db/sqlite.ts:105`، `db/pg.ts:97`، `canonical/types.ts` |
| 5 — استهلاك المحفَز (النصف الثاني) | `reevaluationCycle.ts`: قفل دورة مستقل → قراءة النسخة الفعالة → **نفس العقل** (`runUnifiedChartAgent`) على حزمة كاملة جديدة → مقارنة الاتجاه/النوع/المستويات/الصلاحية/السيناريو → `confirmed` بلا نسخة، أو `applyRecommendationRevision`؛ `invalidated` من العقل لا من المتعقب؛ لقطة أدلة وأثر قرار مع كل نسخة؛ عدّادان في `metrics.ts`؛ الدورات تعمل بعد المسح الحتمي فلا يؤخّر نداءُ نموذجٍ تقييمَ وقفٍ | `implemented` | `reevaluationCycle.ts`؛ `reevaluationCycle.test.ts` (15 اختبار تكامل عبر قاعدة البيانات: تأكيد بلا نسخة · نسخة عند تغيّر المستويات/الاتجاه/النوع · `stale_revision` بعدها · تخطي الطرفية والعائق التشغيلي والعلم المُطفأ · قفل يمنع دورتين · حارس أن الدورة تستخدم نقطة العقل نفسها) |
| 5 — رصد المحفزات (النصف الأول) | وحدة `reevaluationTriggers.ts`: سبعة محفزات آلية + طلب المستخدم + البحث العميق؛ جدول `recommendation_reevaluations` بمفتاح تكرار؛ cooldown 15د، سقف 6 دورات آلية، دورة واحدة لكل مسح؛ طلب المستخدم مستثنى؛ المتعقب يرصد ويعيد المحفزات ولا يقرر | `implemented` (الرصد والحدود والتسجيل) · `partial` (تشغيل دورة القرار من المحفَز لم يُوصَّل بعد) | `reevaluationTriggers.ts`؛ `reevaluationTriggers.test.ts` (19 اختباراً، منها حارسان بنيويان: المتعقب لا يستدعي النسخ ولا العقل، والمحفَز لا يحمل اتجاهاً) |
| 6،7 — `retest_started` و`breakout_no_retest` | معرَّفان في العقد ويُصدرهما المشتق بشرطين قابلين للاختبار (عودة للمستوى / تجاوز 2 ATR)، بمفتاح نسخة | `implemented` (الاشتقاق والإشعار) · `partial` (لم يُغذَّ `retestLevel` من المتعقب بعد، ولا واجهة) | `lifecycleEvents.ts`؛ `lifecycleEvents.test.ts` (5 اختبارات) |

### ما لم يُنفَّذ في هذه الجلسة (باقٍ صريحاً)

| المرحلة في مهمة الإغلاق | البنود | الحالة |
|---|---|---|
| 2 | الواجهة كاملة: مبدّل الوضع + لوحة الانتظار · مركز إشعارات + SSE · صفحة دفتر الأداء | `missing` |

| 4 (بقية) | تغذية `retestLevel` من المتعقب · `evidence_source` في MCP والنسخ · تغطية replay · أثر الحدثين في الواجهة | `partial` |
| 5 | Rectangle · Cup & Handle (وعكسه) · Triple Top/Bottom · مولّد `pattern_boundary` | `missing` |
| 6 | جولة الفريم الإضافي | `missing` |
| 7 | ملف التكلفة الجلسي الحي من عروض EA | `missing` (المضاعِفات الثابتة قائمة) |
| 8.1–8.9 | إشعار الحدث الاقتصادي · نسخة إدارة الصفقة · الملاحظات الشخصية · سجل اختلاف المنصة/MCP · لوحات القياس · حزمة fixtures حقيقية · نتائج المراحل الجزئية · pgvector · تمرين الإغلاق | `missing` |

**السبب**: حجم المهمة يتجاوز نافذة سياق واحدة. أنجزتُ المراحل 0 و1 وجزءاً من 4 بالكامل واختباراتها خضراء ومُودَعة؛ الباقي لم أبدأه، ولم أدّعِ خلاف ذلك.
