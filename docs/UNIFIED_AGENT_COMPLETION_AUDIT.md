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
| 20 — لوحات القياس | 14 مقياساً + `criticalAlert()` + `/api/admin/diagnostics` يقرأ من سجلّ Prometheus نفسه؛ نقاط الرصد عند مواضع الرفض الفعلية (WAIT في مسار الكتابة، wrong-mode عند رفضَي التفويض، stale في `executeIntent`، التكرار في المُبلِّغ، الاكتمال والكمون في المنسّق) | `implemented` | `metrics.ts`، `admin/diagnostics/route.ts` |
| 10–12 — الكواشف الخمسة | Rectangle · Triple Top/Bottom · Cup & Handle (وعكسه)، بنفس انضباط الحالات والحتمية؛ الحالات السلبية بالاسم (حدود متقاربة ليست مستطيلاً، ثلاث قمم صاعدة ترند، عروة عميقة قاعٌ فشل، V ليست كوباً) | `implemented` | `rectangles.ts`، `tripleExtremes.ts`، `cupHandle.ts`؛ `newDetectors.test.ts` (16) |
| 13 — مولّد `pattern_boundary` | حدود النماذج قيد التكوين تصبح مناطق POI حقيقية تدخل `buildTradeCandidates` بنفس قواعد التقييم؛ الهندسة نُقلت **قبل** محرك المرشحات وحارس يثبّت الترتيب | `implemented` | `patternBoundaryZones.ts`؛ `patternBoundaryZones.test.ts` (7) |
| 14 — جولة الفريم الإضافي | جولة واحدة كحد أقصى بنيوياً؛ قائمة بيضاء؛ رفض فريم معروض؛ فشل الالتقاط أو النداء الثاني يُبقي القرار الأول؛ مقاييس لكل النتائج | `implemented` | `finalDecisionSynthesizer.ts`؛ `extraFrameRound.test.ts` (7 — منها إثبات نداءين والتقاط واحد كسقف) |
| 15 — ملف التكلفة الحي | عيّنات من عروض EA عبر كرون المراقبة → `cost_samples` → تجميع median/p90/انزلاق-التشتت لكل رمز×جلسة؛ دون 20 عينة أرقام null؛ fallback ثابت **موسوم** `static_model`؛ التقادم جزء من الجواب | `implemented` | `liveCostProfile.ts`؛ `liveCostProfile.test.ts` (7) |
| 24 — تمرين الإغلاق (معيار 12) | مزوّد أدلة تجريبي (طور القمر — عمداً) يصل النموذج عبر حقل الحزمة فقط، ومصدر محفّز جديد يمر بحدود القبول نفسها؛ التمرين يفحص نفسه أنه لم يلمس العقل ولا النسخ ولا التنفيذ | `implemented` | `architecturalClosing.test.ts` (4) |
| 19، 20 (جزء) — سجل اختلاف المنصة/MCP | `parityLog.ts` + جدول `decision_parity` بمفتاح `(evidence_hash, surface)`؛ سبعة تصنيفات بترتيب مقصود: القابلية للمقارنة أولاً، ثم الأسباب البيئية المشروعة، ثم اثنان يُعدّان نتائج حقيقية (`contract_mismatch` و`unexplained`)؛ `/api/admin/parity` يعيد `unexplained` أولاً؛ مقياسان في `metrics.ts`؛ اللحظات غير المزدوجة تُعدّ لا تُحسب توافقاً | `implemented` — السجل والتصنيف والواجهة البرمجية والمقياسان ونقطتا الرصد على السطحين. **ملاحظة معمارية**: السطحان يشتركان في العقل نفسه (أداة MCP تُمرِّر إلى `/api/agent/market/analyze` التي تنادي `runUnifiedChartAgent`)، فالسطح خاصية نقطة الدخول لا مسار قرار ثانٍ. وبالتالي التشغيل الواحد يكتب صفاً واحداً، والأزواج القابلة للمقارنة (نفس `evidence_hash` من سطحين) تُنتجها عُدة الـfixtures المرجعية (المجموعة 10) لا الإنتاج العادي | `parityLog.ts`؛ `parityLog.test.ts` (13 اختباراً، منها **الحارس المطلوب صراحة**: قرارَان متطابقان بايتاً باختلاف `evidence_hash` لا يُعدّان متطابقين، وانقلاب الاتجاه لا يُعذَر كتشتّت نموذج) |
| 5 — استهلاك المحفَز (النصف الثاني) | `reevaluationCycle.ts`: claim ذري ومفتاح تكرار وحارس stale وقفل موزّع لنفس التوصية → قراءة النسخة الفعالة → **نفس العقل** (`runUnifiedChartAgent`) بوضع إعادة التقييم على Evidence Bundle كاملة جديدة ومجمّدة → مقارنة الاتجاه/النوع/المستويات/الصلاحية/السيناريو/حالة التنفيذ → `confirmed` بلا نسخة مطابقة، أو `applyRecommendationRevision`؛ `invalidated` انتقال قانوني ذري من حكم العقل لا من المتعقب؛ كل حكم يحفظ trigger payload وevidence hash وEvidence Snapshot وDecision Trace؛ الإشعار والمقاييس جزء من الدورة؛ وقفل التوصية مشترك مع الإرسال فيغلق سباق check/send ويرفض `stale_revision`؛ claim غير المكتمل يبقى في طابور DB ويُستأنف بعد انشغال القفل أو انقطاع العملية؛ الهجرة تغلق صفوف ما قبل الطابور فقط كي لا يعيد أول نشر تشغيل السجل التاريخي | `implemented` | `reevaluationCycle.test.ts` (17، ومنها إثبات بقاء طلب claimed عند التزاحم ثم استهلاكه لاحقاً)؛ `reevaluationEndToEnd.test.ts` (2: كاشف الإنتاج يستهلك عرض EA الفعلي، ثم Trigger → durable claim/dedupe → مستهلك DB → العقل الموحد الحقيقي → Revision → transition → notification → metrics عبر SQLite فعلية، مع intent قديم يُرفض `stale_revision`)؛ `reevaluationMigration.test.ts`؛ `evidenceBundleImmutability.test.ts` |
| 5 — رصد المحفزات (النصف الأول) | `reevaluationTriggers.ts`: سبعة محفزات آلية + طلب المستخدم + البحث العميق؛ payload منظّم بلا direction أو levels؛ cooldown 15د وسقف 6 دورات آلية ودورة واحدة لكل مسح؛ طلب المستخدم والبحث العميق يتجاوزان cooldown/cap ولا يضيعان عند تنازع قفل القبول؛ مفاتيح أحداث ثابتة مع نافذة زمنية للحالات المستمرة كي لا يتحول dedupe إلى منع دائم؛ المتعقب يمرر structure/pattern/HTF/live-spread/invalidation الفعلية ويطلب طبقة الدورة ولا يقرر؛ نقطة API مخصصة لطلب المستخدم؛ اكتمال البحث العميق يمر بالثلاثية نفسها | `implemented` (الرصد والقبول والاستهلاك End-to-End) | `reevaluationTriggers.test.ts` (22، منها حارسان بنيويان واختبار إعادة القبول بعد cooldown)؛ `deepResearchVerdict.test.ts` (5)؛ `economicEventMonitor.test.ts` (5)؛ `api/recommendations/[id]/reevaluate/route.ts` |
| 6،7 — `retest_started` و`breakout_no_retest` | معرَّفان في العقد ويُصدرهما المشتق بشرطين قابلين للاختبار (عودة للمستوى / تجاوز 2 ATR)، بمفتاح نسخة | `implemented` (الاشتقاق والإشعار) · `partial` (لم يُغذَّ `retestLevel` من المتعقب بعد، ولا واجهة) | `lifecycleEvents.ts`؛ `lifecycleEvents.test.ts` (5 اختبارات) |

### نافذة العمل الموزَّع (وكلاء فرعيون + مراجعة فجوات من الكود) — الإيداعات `118efec`..`f12f4c9`

| البند | ما تغيّر | الحالة النهائية | الدليل |
|---|---|---|---|
| المجموعة 9 — الواجهة كاملة | `TradeModePanel` (المبدّل عند اتصال مستقر فقط + تأكيد صريح + شارة دائمة + عرض `AUTO_EXECUTION_STAGE` + هبوط الانقطاع دون استرجاع تلقائي) · `ActiveRecommendationsPanel` (العقد كاملاً: الطبقات الثلاث والنسخة الفعالة وبطاقة الأدلة وأثر القرار وآخر محفز وآخر سبب امتناع) · مركز إشعارات + مسار SSE `/api/alerts/stream` فوق `alert_log` (استئناف بالمعرّف، heartbeat، backoff) · صفحة دفتر الأداء `/journal` بتحذيرات العينة الصغيرة · صفحة تشخيصات الأدمن (العدّادات الحرجة أولاً وبالأحمر عند > 0) — عربي/إنجليزي كاملان | `implemented` | إيداع `6878fb1`؛ `navigation.test.ts` أخضر |
| 8.1 — إشعار الحدث الاقتصادي | `economicEventMonitor.ts` في دورة المراقبة: إشعار واحد لكل (توصية، حدث، نسخة) عبر نفس آلية التكرار + محفز `economic_event` عبر نفس حدود القبول؛ غياب المزود = لا اختلاق | `implemented` | إيداع `2f4ffdb`؛ `economicEventMonitor.test.ts` |
| 8.2 — نسخة إدارة الصفقة | `tradeManagement.ts`: نسخة على صفقة مفتوحة → مزامنة عبر مسار `modify_sl_tp` حصراً؛ advisory = طلب موافقة (intent بمصدر `trade_management` **يرفضه `executeIntent` بنيوياً**)، auto = تفويض قائم + درجة الإطلاق؛ المزامنة نسخة append-only بمستويات منسوخة لا مُقرَّرة | `implemented` | إيداع `2f4ffdb`؛ `tradeManagement.test.ts` |
| 8.3 — الملاحظات الشخصية | `personalNotes.ts` فوق عتبات خط التعلم نفسها (5 / 0.65)؛ جلسات وR حقيقية من `recommendation_outcomes`؛ تصب في كتلة الدروس دليلاً لا قيداً؛ دون العتبة لا شيء | `implemented` | إيداع `2f4ffdb`؛ `personalNotes.test.ts` |
| 8.7 — نتائج المراحل الجزئية | `forwardOutcome.ts`: للنماذج قيد التكوين — اكتمل/فشل لاحقاً، الدخول المبكر مقابل المؤكد لنفس الأفق، الاختراق الكاذب، الصافي بعد تكلفة الجلسة — من شموع بعد اللحظة حصراً؛ أعمدة إضافية بكلا اللهجتين؛ الصفوف القديمة لا تُعاد قراءتها | `implemented` | إيداع `d11f215`؛ اختبارات marketMemory ‏46/46 |
| 8.8 — pgvector | عمود `embedding vector(8)` + فهرس HNSW→ivfflat محروسان بالكامل؛ KNN حقيقي على PG بنفس الفلاتر والشكل؛ SQLite وPG بلا امتداد يبقيان على مسار JS؛ فشل أي خطوة = تحذير وتراجع، لا انهيار | `implemented` | إيداع `d11f215`؛ `caseVector.test.ts` |
| إحكام التنفيذ (فجوتا التدقيق 1 و2) | `executeIntent` نفسه يقرأ `authorization_source`: ‏`standing_auto` يعيد التحقق من التفويض لحظة التنفيذ (`auto_mode_revoked`)، `user_approved` يتطلب الموافقة الصريحة فعلاً، `trade_management` والمجهول يُرفضان بالاسم (`unauthorized_source`)؛ وفحص `stale_revision` يعمل لكل intent مرتبط بتوصية — المنشئون الثلاثة يختمون النسخة الفعالة والقديم يُستكمل داخل التدفق | `implemented` | إيداع `118efec`؛ `executionSourceEnforcement.test.ts` (8) + الحزم الخمس 39/39 |
| H.4 — وصول أدلة الباكتيست | `researchEvidence` يجيب من ملخص الدعم المُحضَّر (`strategy_deployments` الذي يملؤه كرون `strategy-pipeline`) فيصبح `backtest: used` ممكناً فعلاً؛ محفز البحث العميق `historicalInsufficient` لم يعد دائم-الصحة | `implemented` | إيداع `f12f4c9` |
| `evidence_source` (تكملة البند 8) | مساران يكتبان العمود الحقيقي: المنصة (`strategy_supported`/`direct_analysis` حسب الدعم) وMCP (خرج من `context_json` إلى العمود) | `implemented` | إيداع `f12f4c9` |
| صلاحية الشموع (B.7) | المقيّم الحتمي يُنهي الخطة غير المفعّلة على الشمعة التي تجاوزت `validityCandles`، لا على الزمن فقط؛ القيمة تدور عبر `legacyRisk` | `implemented` | إيداع `f12f4c9` |
| تغذية retest (تكملة 6،7) | المتعقب يمرر `retestLevel` (دخول خطط `*retest*`) و`excursionAtr` من نفس الشموع؛ الحدثان قابلان للإطلاق فعلاً؛ تصحيح انعكاس تسميات الحكم (revised=`entry_updated`، invalidated=`scenario_changed`، confirmed يُسجَّل ولا يُعلَن كتغيير) | `implemented` | إيداع `f12f4c9` |
| `timeframe_roles` (E) | افتراض بنيوي عند غياب إجابة النموذج (الفريم القائد = فريم التحليل) + حفظ الحكم مع أثر القرار في النسخة 1 | `implemented` | إيداع `f12f4c9` |
| الأطلس الانتقائي (F.1) | إعادة اختيار المهارات بعد الهندسة بمفتاح أسماء النماذج **المكتشفة فعلاً** (`detectedPatterns` في سياق الاختيار + دفعة للأطلس) | `implemented` | إيداع `f12f4c9` |
| وضع MCP في الجلسة (D.3) | `get_account_overview` يعيد `trade_mode`؛ نص bootstrap وAGENTS.md متطابقان مع mcp-core (اسأل مرة عند unset) | `implemented` | إيداع `f12f4c9` |
| التقرير الأسبوعي (§17) | `weeklyReport.ts` + كرون الأحد 18:00: الحرجة أولاً، نشاط 7 أيام من الجداول، عدّادات العملية موسومة «منذ آخر تشغيل» | `implemented` | إيداع `f12f4c9` |
| المجموعة 1 — محفزات إعادة التقييم End-to-End | اكتملت فجوات التدقيق الفعلية: مدخلات المتعقب الإنتاجية، claim ذري، أولوية user/deep research، Evidence Snapshot كاملة ومجمّدة، منع إنشاء توصية/بحث عميق جانبي أثناء إعادة التقييم، مقارنة كل حقول القرار، `confirmed` بلا Revision مكرر، `invalidated` بانتقال قانوني، trigger payload/evidence/trace لكل حكم، إشعار ومقاييس، وقفل مشترك يغلق سباق التنفيذ | `implemented` | `reevaluationEndToEnd.test.ts` + حزم الدورة/المحفز/البحث العميق/الحدث الاقتصادي؛ الإيداع الحالي لهذه المجموعة |

### الباقي صراحةً

| البند | الحالة |
|---|---|
| المجموعة 10 — عُدة fixtures حقيقية (شموع مسجلة + صور + تكاليف + تقويم) تشغّل السطحين E2E عبر القاعدة/القانوني/النسخ/الإشعارات وتغطي جدول §16، وفيها تُقاس أزواج المساواة (unexplained=0) | `missing` — البند الكبير الأخير |
| مُنتِج حدث `opportunity_created` عبر مفتاح التكرار (الإنشاء ما زال يُشعر عبر المسار القديم) | `partial` |
| قياسا late-entry/early-exit في `canonical/analytics.ts` (محسوبان اليوم في مسار الدفتر/الواجهة) | `partial` |
