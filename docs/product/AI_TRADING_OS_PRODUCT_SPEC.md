# AiChart — AI Trading Operating System
## Product Specification v1.0 (Design Only)

> **Supersession:** For investor/CTO decisions, IA ruthlessness, MVP scope, and pushbacks, prefer  
> [`AI_TRADING_OS_MASTER_SPEC.md`](./AI_TRADING_OS_MASTER_SPEC.md) (v2.0). This v1.0 remains a detailed inventory; where they conflict, **Master wins**.

> **Status:** Product Design Spec — لا كود في هذه المرحلة  
> **Role lens:** Chief Product Architect × UX Lead × AI Systems Architect  
> **Positioning shift:** من *AI Recommendation Platform* → إلى *AI Trading Operating System*  
> **Core principle:** وكيل ذكي واحد (Unified Agent) يشغّل كل الأسطح — Web, MCP, MT5, Telegram, Mobile, API — بلا منطق مكرّر.

---

# 0. Competitive Intelligence — ماذا نتعلّم ولماذا نعيد التصميم

لا ننسخ واجهاتهم. نأخذ **الفلسفة الجوهرية** ونُذيبها داخل تجربة واحدة يقودها وكيل واحد.

## 0.1 AlgoBuilder — Strategy Construction

| ما هو جيد | لماذا | كيف نعيد تصميمه داخلنا |
|---|---|---|
| Idea → Chat → Strategy في جلسة واحدة | يقلّل الاحتكاك بين الفكرة والتنفيذ | نفس التدفق، لكن الناتج ليس ملف Python/EA بل **Strategy Object حي** داخل OS |
| AI يطرح أسئلة توضيحية (risk, session, trailing) | يحوّل النية الغامضة إلى قواعد قابلة للتنفيذ | يصبح جزءًا من دور **AI Strategy Builder** داخل نفس المحادثة |
| Backtest قبل النشر | يمنع وهم الاستراتيجية | يصبح **Backtest Intelligence** يشرح *لماذا* ويقرح تحسينًا، لا مجرد أرقام |
| Optimizer سحابي | يكشف الهشاشة قبل Live | طبقة **Optimizer** دورية + عند الطلب، مربوطة بـ Strategy Versions |
| Deploy إلى MT5 | يغلق الحلقة | Deploy إلى **Bot Runtime** داخل AiChart مع Approval / Evidence / Auto Execution الموجودة أصلًا |

**الفكرة الجوهرية المستعارة:** بناء الاستراتيجية من اللغة الطبيعية.  
**ما نرفضه:** أن يكون البناء أداة منفصلة تُصدّر كودًا خارج النظام.

## 0.2 TrueNorth — Optimization + Agentic Intelligence

| ما هو جيد | لماذا | كيف نعيد تصميمه داخلنا |
|---|---|---|
| Structured conviction بدل walls of text | المتداول يحتاج قرارًا قابلًا للعمل لا مقالًا | عقد التوصية الثلاثي الموجود أصلًا (رأي / نوع خطة / حالة تنفيذ) + Decision Trace |
| MCP كواجهة للعقل لا مجرد أدوات | يوسّع الوكيل إلى Claude/Cursor دون تكرار منطق | MCP = **Remote Brain** لنفس الوكيل الواحد |
| Contextual memory عبر الجلسة | لا يبدأ من صفر في كل سؤال | AI Trading Memory + Atlas |
| Playbooks كـ workflows متعددة الخطوات | تسرّع البحث المؤسسي | تُعاد كـ **Agent Roles / Skills** لنفس الوكيل، لا كـ Agents منفصلة |
| Charts over hedging language | الثقة تأتي من الدليل لا من الصياغة | Evidence Bundle مرئي دائمًا بجانب القرار |

**الفكرة الجوهرية المستعارة:** تحسين وتحليل الاستراتيجيات القائمة + عقل بعيد عبر MCP.  
**ما نرفضه:** أن يكون التحسين منتجًا منفصلًا عن البناء والمراقبة.

## 0.3 AlgoCoinism — Alpha Discovery / Market Monitoring

| ما هو جيد | لماذا | كيف نعيد تصميمه داخلنا |
|---|---|---|
| مراقبة مستمرة + Market Radar | الفرصة لا تنتظر فتح الشارت | **Layer 1 Market Intelligence** + **Layer 8 Market Radar** |
| جاهزية استراتيجيات مُختبَرة بضغطة | يسرّع التفعيل | Marketplace + Bot Templates + Strategy DNA search |
| AI مساعد متكامل مع البوتات | يقلّل التبديل بين الأدوات | نفس الوكيل يدير البوتات من داخل المحادثة |
| Whale / flow awareness | سياق يتجاوز الشمعة | يدخل Evidence Bundle كأدلة Market Intelligence |

**الفكرة الجوهرية المستعارة:** الاكتشاف المستمر — "يوجد شيء مهم يحدث الآن".  
**ما نرفضه:** إشارة Buy/Sell سطحية بلا Evidence وبدون طبقة قرار.

## 0.4 TradingView — Chart-Centric Universe

| ما هو جيد | لماذا | كيف نعيد تصميمه |
|---|---|---|
| الشارت مركز الجاذبية | لغة المتداول بصرية | Workspace بأسلوب IDE والشارت في الوسط |
| Bottom panel (Editor / Logs) | سياق العمل دون مغادرة الشارت | Logs / Backtests / Terminal / Journal / Debugger |
| Community + Publish | تأثير شبكي | Marketplace (استراتيجيات، بوتات، قوالب) بهوية أداء لا منشورات فقط |
| Layout persistence | كل متداول له طقوس | Workspaces مخصصة (Trader / Quant / Research…) |

## 0.5 LuxAlgo — Constrained Intelligence

| ما هو جيد | لماذا | كيف نعيد تصميمه |
|---|---|---|
| AI يبحث داخل مساحة مفاهيم مُثبتة لا يخترع | يقلّل الهلوسة في التداول | Optimizer و Strategy Builder يعملان فوق محرك قواعد/أدلة محدد، لا LLM حر |
| NL → استراتيجيات مُقيَّمة إحصائيًا | يسرّع الاكتشاف | Strategy DNA + Backtest Intelligence |
| مكتبة مفاهيم كـ intelligence engine | المعرفة قابلة لإعادة الاستخدام | Atlas Playbooks + Skill System الموجود |

## 0.6 TrendSpider — Automation of Analysis

| ما هو جيد | لماذا | كيف نعيد تصميمه |
|---|---|---|
| Automated TA + multi-TF | يوفر وقت المسح اليدوي | Layer 1 تكتشف Structure/Liquidity/FVG… تلقائيًا |
| No-code Strategy Tester + NL | يوسّع الوصول | Strategy Canvas + Chat موحّدان |
| Scanner → Strategy → Alert pipeline | مسار واضح من الاكتشاف للتنفيذ | Radar → Decision → Strategy/Bot → Execution |

## 0.7 الخلاصة الاستراتيجية للمنافسة

المنافسون يقدّمون **أدوات ممتازة منفصلة**. فجوة السوق التي نملأها:

> **نظام تشغيل تداول واحد** حيث البناء + الاكتشاف + التحسين + التنفيذ + التعلّم يحدثون داخل وكيل واحد، فوق بنية أدلة وقرارات قابلة للتفسير (Evidence Bundle → Decision → Revision → Execution → Memory).

---

# 1. Vision & Product Philosophy

## 1.1 Vision

**AiChart هو AI Trading Operating System** — بيئة عمل كاملة يدير فيها وكيل ذكي واحد دورة حياة التداول كاملة:

```text
Observe → Understand → Decide → Construct → Test → Optimize → Deploy → Execute → Explain → Learn
```

ليس:
- منصة توصيات فقط
- Connector لـ MT5 فقط
- MCP Server فقط
- مجموعة أدوات يتنقّل بينها المستخدم

بل:
- **عقل واحد** يظهر عبر أسطح متعددة
- **استراتيجيات حية** لا إشارات ثابتة
- **بوتات وكيلة** تعمل 24/7 داخل النظام
- **ذاكرة تداول** تُستخدم تلقائيًا في القرار القادم

## 1.2 Product Philosophy (عقيدة المنتج)

1. **Agent is the product.** الواجهة سطح؛ الوكيل هو المنتج.
2. **One brain, many surfaces.** نفس منطق القرار على Web / MCP / Telegram / Mobile / API / MT5 bridge.
3. **Evidence before conviction.** لا قرار بلا حزمة أدلة قابلة للمراجعة.
4. **Direction always; entry not always.** الرأي التحليلي موجود دائمًا؛ التنفيذ مشروط بالجودة والتكلفة والسلامة.
5. **Strategies are living managers, not static signals.** الاستراتيجية تراقب النظام (Regime) وتعدّل السلوك.
6. **Bots are agents with lifecycle, not toggles.** Draft → … → Live → Learn → Rollback.
7. **Explainability is a correctness condition.** قرار لا يُفسَّر من Evidence + Trace + Revision = غير صالح معماريًا.
8. **No duplicated logic.** أي قدرة جديدة تُضاف مرة واحدة في العقل، ثم تُكشف عبر الأسطح.
9. **Proactive, not chatbot-reactive.** الوكيل يبادر عند فتح رمز أو تغيّر السوق أو تدهور استراتيجية.
10. **Premium calm density.** كثافة معلومات بمستوى Bloomberg، بهدوء Linear/Cursor، لا فوضى كروت ولا لوحة إحصاءات في الـ Hero.

## 1.3 Who we build for (Personas)

| Persona | الوظيفة الأساسية داخل OS |
|---|---|
| Discretionary Trader | Workspace + Copilot + Decisions |
| Systematic / Quant | Strategy Canvas + Backtest + Optimizer + DNA |
| Automation Operator | Bots lifecycle + Health + Risk |
| Portfolio Manager | Multi-account / exposure / capital allocation |
| Researcher | Research Center + Replay + Cases |
| Team Lead (v2) | Shared workspaces, permissions, audit |

## 1.4 North-star metric

**Time-to-Trusted-Action:** الزمن من "حدث سوقي مهم" إلى "قرار مفسَّر جاهز للتنفيذ أو الرفض الواعي"، مع بقاء نسبة القرارات القابلة للتفسير ≈ 100%.

---

# 2. الأدوار الموحدة للوكيل + النموذج الطبقي للذكاء

## 2.1 Unified Agent — أدوار لا Agents منفصلة

يوجد **Agent Identity واحد**. الأدوار أوضاع سلوك (modes) داخل نفس الجلسة، يتنقّل بينها الوكيل بسلاسة دون أن يشعر المستخدم أنه غيّر "بوتًا".

| Role | متى يُفعَّل | مخرجاته الأساسية |
|---|---|---|
| **AI Analyst** | فتح رمز، سؤال سوق، تنبيه Layer 1 | Regime, Structure, Evidence, Direction, Plan Type |
| **AI Strategy Builder** | "ابنِ استراتيجية…"، تعديل Canvas | Rules, Canvas graph, Risk engine, Strategy draft |
| **AI Optimizer** | تراجع أداء، طلب "حسّن" | Version مقترحة + مقارنة هشاشة |
| **AI Backtester** | بعد البناء أو قبل Deploy | Backtest Intelligence report + تحسينات |
| **AI Portfolio Manager** | تعارضات حسابات/رموز/مخاطر | Allocation, pause/resume strategy advice |
| **AI Trader** | وجود خطة صالحة + وضع تنفيذ | Intent → Approval/Auto → Execution (الحراس الحاليون) |
| **AI Coach** | بعد قرار/صفقة/خسارة/سؤال تعلّمي | Explanation, lesson, playbook update |

### Role Transition Model (داخل نفس المحادثة)

```text
[User opens XAUUSD]
  → Analyst (proactive brief)
  → User: "ابنِ بوت لندن بعد liquidity sweep"
  → Builder (Strategy + Bot draft)
  → Backtester (auto)
  → Optimizer (إن ضعف الأداء أو بطلب)
  → Trader (Paper/Demo/Live حسب السياسة)
  → Coach (لماذا انتظر / لماذا دخل / ماذا نتعلم)
  → Portfolio Manager (إن تعارض مع مركز مفتوح)
```

الانتقال يُسجَّل في **Decision Trace** كـ `role_transitions[]` دون كسر هوية الوكيل.

## 2.2 AI Intelligence Layers (8 + Memory)

### Layer 1 — Market Intelligence *(مستوحى من AlgoCoinism، معاد تصميمه)*

- **الوظيفة:** مراقبة 24/7 واكتشاف أحداث هيكلية/سياقية.
- **يكتشف:** Liquidity Sweep, Order Blocks, FVG, BOS, CHoCH, Breakout, Compression, Volume Spike, ATR Expansion, Correlation, Sentiment, News, COT, DXY, Bond Yields…
- **ناتج الطبقة:** `MarketEvent` = "يوجد شيء مهم يحدث الآن" + درجة أهمية + رموز متأثرة — **وليس** أمر Buy.
- **فوق الأساس الحالي:** يغذّي Evidence Bundle كأدلة من نوع `market_intelligence_*` بدل أن يكون مصدر إشارات مستقل.

### Layer 2 — AI Brain *(قلب القرار الحالي موسّعًا)*

- **الوظيفة:** تحويل Evidence Bundle المجمّد إلى قرار.
- **يتوافق مع:** Evidence Bundle → Decision → Decision Trace → Recommendation Revision.
- **مخرجات:** الرأي التحليلي + نوع الخطة + حالة التنفيذ (العقيدة الثلاثية المعتمدة).
- **قاعدة:** العقل لا يملك حالة داخلية دائمة؛ يقرأ الحزمة فقط.

### Layer 3 — Strategy Engine *(مستوحى من AlgoBuilder، معاد تصميمه)*

- عدة استراتيجيات تعمل فوق نفس محرك الذكاء.
- الاستراتيجية = Workflow قواعد + Risk + Sessions + News filter + Execution policy.
- ليست سكربتًا خارجيًا؛ هي كائن أول-صنف في OS.

### Layer 4 — Optimizer *(مستوحى من TrueNorth بمعنى التحسين، لا نسخه)*

- مراجعة دورية + عند الطلب.
- يشخّص سبب التراجع (Regime shift / cost / news / session drift / overfitting).
- يقترح Version جديدة مع مقارنة هشاشة، لا يطبّق Live دون موافقة/سياسة.

### Layer 5 — Portfolio AI

- قرارات عبر حسابات واستراتيجيات ورموز.
- أمثلة: "اليوم لا تشغّل Strategy X"، "خفّض المخاطر بسبب correlated exposure".
- يحترم Risk Center كسلطة حدود.

### Layer 6 — Research AI

- أسئلة مفتوحة + بحث عميق عند الطلب.
- يجمع مصادر Research Center، يجرّب الفرضيات عبر Backtest/Simulation عند الحاجة، يُخرج تقريرًا مربوطًا بأدلة.
- يوسّع المسار الحالي للبحث العميق: يقوّي/يضعّف/يحدّث التوصية مع تسجيل السبب — لا يستبدلها صامتًا.

### Layer 7 — Copilot

- واجهة اللغة الطبيعية لكل الطبقات ("ابنِ ICT"، "لماذا خسرت؟"، "ماذا أفعل؟").
- يشبه GitHub Copilot مفهومًا: يقترح ويُنفّذ أدوات داخل السياق، لا يستبدل الحوكمة.

### Layer 8 — Market Radar

- أهم N فرص الآن (افتراضيًا 10) مع: Confidence, AI rationale, News, Similar Cases, Cost, Probability.
- كل بطاقة Radar تفتح Decision surface، لا تنفّذ مباشرة.

### AI Trading Memory *(عرضي عبر كل الطبقات)*

يحفظ أكثر من الصفقات:
- لماذا دخل / لماذا رفض
- شكل السوق وقت القرار
- ماذا تعلّم / ماذا تغيّر
- تفضيلات المستخدم وأخطاؤه وانتصاراته
- Strategy Memory + Case Memory

**شكل العرض المطلوب:**
> "رأيت هذا السيناريو 184 مرة. Win 71%. عند وجود خبر قوي تنخفض إلى 48%. في جلسة لندن ترتفع إلى 78%. إذا كان السبريد أكبر من 2.5 نقطة تصبح غير مجدية."

يُبنى فوق: Semantic Memory, Trade Lessons, Historical Cases, Decision Trace, Revisions, Learning Events.

## 2.3 توزيع الطبقات على أقسام المنتج

| القسم | طبقات أساسية |
|---|---|
| Command Center / Radar | L1, L8, Memory |
| Workspace | L2, L7, L3 |
| Decisions / Recommendations | L2, Memory, L6 |
| Strategies | L3, L4, L7 |
| Bots | L3, L4, L5, L2 |
| Research | L6, L1 |
| Portfolio / Risk | L5 |
| Journal / Analytics | Memory, L4 |
| Atlas | Memory + Playbooks |
| Marketplace | L3 artifacts + performance proofs |
| MCP / Telegram / Mobile | كل الطبقات عبر نفس العقل |

---

# 3. Information Architecture + UI Sitemap

## 3.1 قرار IA: ماذا نحذف / ندمج / نرفع

القائمة المقترحة في الطلب جيدة كمخزون قدرات، لكن كـ Nav تُنتج منتجًا مفككًا. الترتيب الأفضل:

### Primary Nav (دائم)

1. **Command** — الصفحة الأم (كانت Home/Dashboard)
2. **Workspace** — IDE التداول (القلب التشغيلي)
3. **Radar** — فرص السوق الآن (كان جزءًا من Markets/Trade Ideas)
4. **Decisions** — التوصيات والقرارات الحية (دمج AI Recommendations + Trade Ideas + Live decision stream)
5. **Strategies**
6. **Bots**
7. **Portfolio** *(يشمل Live Trades)*  
8. **Research**
9. **Atlas**
10. **Marketplace**

### Secondary / Utility

- **Risk Center** — ليس صفحة يتيمة؛ **وضع (mode)** فوق Portfolio + شريط دائم في Workspace
- **Journal** — تبويب تحت Atlas *أو* لوحة سفلية في Workspace؛ صفحة كاملة للمراجعة الأسبوعية
- **Analytics** — داخل Portfolio + Strategies + Bots؛ صفحة Executive Analytics اختيارية
- **News / Calendar** — داخل Research + لوحة يمين Workspace
- **Community** — يُؤجَّل لـ v2 (Marketplace يغطي الجانب الأدائي؛ الاجتماعي لاحقًا)
- **Agents** — **يُحذف من الـ Nav.** لأن المنتج وكيل واحد. ما كان يُسمى Agents يصبح: (أ) أدوار الوكيل الظاهرة في الجلسة، أو (ب) Bots
- **AI Analyst / AI Recommendations** — تُذاب في Decisions + Copilot
- **Settings** — حساب، وسطاء، تنفيذ، إشعارات، تكاملات، صلاحيات

### لماذا هذا أفضل؟

- يقلّل تكرار "أين أجد التوصية؟"
- يجعل Workspace مركز العمل اليومي
- يمنع تضخم Nav بأسماء Agents متعددة تُربك وعد "وكيل واحد"
- يفصل **اكتشاف (Radar)** عن **قرار (Decisions)** عن **نظام (Strategies/Bots)**

## 3.2 UI Sitemap

```text
Command
 ├─ Morning Brief / Session Brief
 ├─ Radar Top Opportunities
 ├─ Active Decisions
 ├─ Bot Health Strip
 └─ Continue where you left off

Workspace  (IDE)
 ├─ Left: Markets · Strategies · Bots · Saved Layouts
 ├─ Center: Charts (+ Strategy overlays)
 ├─ Right: AI Copilot · Evidence · News · Orders
 └─ Bottom: Logs · Backtests · Terminal · Journal · Debugger

Radar
 ├─ Opportunity Board (Top N)
 ├─ Event Stream (L1)
 └─ Filters: Session · Asset · Confidence · Cost · News

Decisions
 ├─ Active / Conditional / Watching
 ├─ Decision Detail (Recommendation Screen vNext)
 ├─ Revision Timeline
 └─ Execution Status

Strategies
 ├─ Library
 ├─ Builder (Chat + Canvas)
 ├─ Backtest Intelligence
 ├─ Optimizer
 ├─ Versions / DNA
 └─ Live Strategy Brain status

Bots
 ├─ Fleet overview
 ├─ Create (NL / Template / From Strategy)
 ├─ Bot Detail (Config · Risk · Logs · Versions · Health)
 └─ Lifecycle controls

Portfolio
 ├─ Accounts & Brokers
 ├─ Positions & Orders (Live Trades)
 ├─ Exposure & Correlation
 ├─ PnL / Drawdown / Calendar
 ├─ Risk Center mode
 └─ Tax exports (v1.5/v2)

Research
 ├─ Sources Hub
 ├─ Economic Calendar
 ├─ Deep Analysis jobs
 ├─ Correlations / Vol / Flow
 └─ AI Research Reports

Atlas
 ├─ Memory
 ├─ Cases ("رأيت هذا السيناريو…")
 ├─ Playbooks / Lessons
 ├─ Journal
 └─ AI Tutor

Marketplace
 ├─ Strategies · Bots · Indicators · Prompts · Templates
 ├─ Performance proofs
 └─ Publish / Follow / License

Settings
 ├─ Profile & Preferences
 ├─ Broker connections
 ├─ Execution modes (Auto / Recommend-only)
 ├─ Notifications (Telegram, push, email)
 ├─ API keys / MCP
 └─ Team (v2)
```

---

# 4. Navigation & User Journey

## 4.1 Principles

- **Progressive disclosure:** Command بسيط؛ الكثافة داخل Workspace و Decision Detail.
- **One continuous thread:** أي بطاقة Radar/Decision/Strategy تفتح سياق الوكيل محملًا بالكائن المعني.
- **No dead ends:** كل شاشة تملك CTA واضحًا للخطوة التالية المنطقية.
- **Surface sync:** ما تفعله في MCP يظهر في Web خلال نفس الهوية والجلسة المنطقية.

## 4.2 Core Journeys

### J1 — Trader يفتح الذهب صباحًا
1. Command يعرض Brief + Radar.
2. يفتح XAUUSD → Workspace يحمّل الشارت.
3. الوكيل (Analyst) يبادر بملخص طبقات: Regime, Liquidity, Structure, News, Similar Cases, Cost, Entry Quality…
4. إن وُجدت فرصة → Decision Card.
5. المستخدم يوافق / يفعّل Auto / يسأل Coach "لماذا الانتظار؟".

### J2 — بناء بوت من جملة
1. من أي سطح: "Create a bot that trades only Gold during London after liquidity sweep".
2. Builder يحوّل إلى Strategy Canvas + Rules + Risk.
3. Backtester يعمل تلقائيًا.
4. Optimizer يقترح تحسينات إن لزم.
5. Lifecycle: Simulation → Paper → Demo → Live.
6. Bot يظهر في Fleet مع Health.

### J3 — تراجع أداء استراتيجية
1. Portfolio/Bots تنبيه: edge decay.
2. Optimizer يفتح مقارنة Versions.
3. يقترح vN+1 مع تفسير السبب.
4. المستخدم يعتمد → Rollback متاح دائمًا.

### J4 — بحث عميق
1. "لماذا الذهب قوي اليوم؟"
2. Research AI يجمع Calendar + DXY + Yields + Structure + Sentiment + Cases.
3. يُخرج تقريرًا مربوطًا Evidence، وقد يحدّث Decision فعّالة إن وُجدت.

### J5 — MCP remote
1. من Claude/Cursor: نفس السؤال.
2. MCP يستدعي نفس الأدوات ونفس العقل.
3. القرار يُكتب في Canonical Recommendations ويظهر في Decisions على الويب.

---

# 5. Workspace Hierarchy

## 5.1 Trading IDE (VSCode-style)

### Left Rail — Explorer
- **Markets:** watchlists, sessions, L1 event badges
- **Strategies:** drafts, live, DNA tags
- **Bots:** fleet status dots (healthy / degraded / stopped)
- **Layouts / Workspaces:** saved perspectives

### Center — Stage
- Multi-chart grid
- Strategy overlays (entry zones, invalidation, structure)
- Bot activity markers (not noisy stickers — subtle state layer)
- Focus mode: single chart + decision ribbon

### Right Rail — Context
Tabs:
1. **AI** (Copilot thread bound to symbol/strategy/bot)
2. **Evidence** (bundle dimensions, hashes, freshness)
3. **News** (calendar + catalysts)
4. **Orders** (working orders, positions, intents)

### Bottom Panel — Workbench
Tabs:
1. **Logs** (agent actions, role transitions)
2. **Backtests** (runs, compare)
3. **Terminal** (command palette / MCP-like commands)
4. **Journal** (auto-draft entries)
5. **Debugger** (why no entry: spread, news window, RR, regime, risk lock…)

### Global Chrome
- Symbol switcher
- Account switcher
- Execution mode pill: `Recommend-only` | `Auto` (موجود كعقيدة)
- Risk temperature
- Agent presence (idle / thinking / monitoring / executing)

## 5.2 Dedicated Workspaces

| Workspace | الهدف | الافتراضي المرئي |
|---|---|---|
| **Trader** | قرارات وتنفيذ | Chart + AI + Orders + Decisions ribbon |
| **Quant** | بناء واختبار | Canvas + Backtests + DNA + Optimizer |
| **Research** | فهم السوق | News/Calendar + Reports + Correlations + Cases |
| **Portfolio** | إدارة رأس المال | Accounts + Exposure + Heatmaps + Risk |
| **Risk** | الحوكمة | Limits, breaches, correlated risk, kill switches |
| **Bot** | تشغيل الأسطول | Fleet, Health, Logs, Deploy pipeline |
| **Team (v2)** | تعاون | Shared strategies, audit, permissions |

كل Workspace = Layout + Default Agent Role bias + Widget set — **نفس البيانات، عدسة مختلفة**.

---

# 6. AI Agent Behavior & Full Lifecycle

## 6.1 Lifecycle

```text
1) Data Arrival
   market ticks, structure engines, news, costs, account state, memory recall
        ↓
2) Intelligence Framing (L1)
   emit MarketEvents / regime snapshot
        ↓
3) Evidence Assembly
   freeze Evidence Bundle (immutable snapshot)
        ↓
4) Thinking (L2 Brain + role)
   produce Decision + Trace + Plan Type + Execution State
        ↓
5) Review Gates
   cost, news, risk, revision CAS, portfolio constraints
        ↓
6) Action
   recommend | schedule conditional | execute (if Auto + safe) | hold with reasons
        ↓
7) Management
   revisions, trade management, invalidation, expiry
        ↓
8) Learning
   outcomes → lessons → case memory → strategy memory → future priors
```

## 6.2 Proactive Behavior (مثال الذهب)

عند فتح Gold، الوكيل لا ينتظر السؤال. يقدّم **Market Opening Brief**:

1. Market Regime  
2. Liquidity map  
3. Trend / Structure  
4. Volume / ATR state  
5. News impact window  
6. Similar historical cases (+ Memory quote)  
7. Statistical confidence (أو وسم "غير متوفر")  
8. Risk context (account + symbol exposure)  
9. Execution quality (spread, slippage expectation)  
10. Cost drag on RR  
11. Alternative scenarios + invalidation  
12. Probability framing  
13. Entry quality now vs better prices  
14. Reasons to wait (إن وجدت) مع بقاء الاتجاه  
15. Auto-management posture إن وُجدت خطة/صفقة  

## 6.3 Role choreography في تفاعل واحد

```text
Analyst → يشرح السوق ويصدر/يحدّث Decision
Coach   → يترجم Decision Trace للمستخدم
Builder → إن طلب المستخدم نظامًا متكررًا
Backtester/Optimizer → يثبت أو يحسّن
Portfolio Manager → يفحص التعارض
Trader  → ينفّذ ضمن Approval/Evidence/Auto
Coach   → يغلق الحلقة بماذا نتعلم
```

## 6.4 Safety non-negotiables (موروثة وموسّعة)

- لا تنفيذ دون وضع صريح.
- أحدث Revision فعّالة فقط.
- Evidence hash مربوط بالقرار.
- الحراس التقنيون (Risk/Execution/Market Sync) تبقى سلطة.
- الذاكرة لا تصبح حقيقة سوق حالية.

---

# 7. MCP Architecture + Tools

## 7.1 MCP = Remote Brain، لا Toolbox مبعثر

MCP يعكس **نفس الوكيل**:
- يتذكر سياق المحادثة والكائنات (استراتيجية، بوت، صفقة، قرار)
- يفهم المراكز المفتوحة، حالة الحساب، البوتات، Journal، Calendar، السوق
- ينفّذ أدوات عبر Tool Registry الموحّد (web/mcp surfaces)
- لا يملك مسار قرار موازي

### Context Object الذي يحمله MCP دائمًا (Logical)

```text
UserIdentity
ExecutionMode
ActiveSymbol
OpenPositions[]
ActiveDecisions[]
ActiveBots[]
ActiveStrategies[]
RiskLimits
CalendarWindow
RecentMemory
ConversationBindings (strategy_id / bot_id / decision_id)
```

## 7.2 Tool Catalog (Product-level)

### Market & Research
- `AnalyzeMarket`
- `GetMarketRadar`
- `ResearchNews`
- `GetEconomicCalendar`
- `FindSimilarCases`
- `GenerateReport`
- `GetCorrelations`
- `GetSentimentSnapshot`

### Strategy
- `CreateStrategy`
- `UpdateStrategy`
- `ExplainStrategy`
- `RunBacktest`
- `CompareBacktests`
- `OptimizeStrategy`
- `GetStrategyDNA`
- `SearchStrategiesByDNA`
- `ListStrategyVersions`
- `RollbackStrategyVersion`
- `SetLiveStrategyBrainState` (pause/reduce/resume)

### Bots / Automation
- `CreateBot`
- `ConfigureBot`
- `DeployBot`
- `StopBot`
- `MonitorBot`
- `SimulateBot`
- `PromoteBotLifecycle` (draft→…→live)
- `RollbackBotVersion`

### Decisions & Execution
- `GetActiveDecisions`
- `ExplainDecision`
- `CreateDecisionFromAnalysis`
- `OpenPosition`
- `ClosePosition`
- `ModifyProtectiveOrders`
- `SetExecutionMode`

### Portfolio / Risk / Journal / Memory
- `GetPortfolioSnapshot`
- `GetExposure`
- `GetRiskStatus`
- `CreateJournalEntry`
- `QueryJournalInsights`
- `RecallTradingMemory`
- `SaveLesson`
- `QueryAtlas`

### Agent / Meta
- `CreateAgentBinding` *(ربط سياق دور/جلسة — ليس إنشاء Agent منفصل)*
- `GenerateWeeklyReview`
- `ListCapabilities`

> ملاحظة تسمية: `Create Agent` في الطلب تُترجم منتجيًا إلى **Create Bot** أو **Create Strategy Automation**. لتجنّب كسر وعد "Agent واحد"، لا نعرض CreateAgent ككيان عقل مستقل في UI.

---

# 8. Bot Builder + Automation + Lifecycle

## 8.1 ما هو Bot في AiChart؟

Bot ≠ مفتاح Auto Trade.  
Bot = **وكيل تشغيلي مُقيَّد باستراتيجية + سياسة مخاطر + دورة حياة**، يعمل 24/7 تحت سلطة Unified Agent وحراس التنفيذ.

## 8.2 Bot Types

Scalping · Swing · News · Grid · Mean Reversion · Trend Following · Breakout · Liquidity Hunter · SMC · ICT · London Session · AI Adaptive · Custom Python · Custom TypeScript · Visual Strategy Bot

كل نوع = Template DNA + default risk posture + required filters.

## 8.3 Natural Language Creation

Input:
> "Create a bot that trades only Gold during London session after liquidity sweep"

Agent output pipeline:
1. Strategy draft (rules + canvas)
2. Risk profile (1% default unless specified)
3. Session + news filters
4. Backtest Intelligence
5. Simulation
6. Deployment plan (Paper first)
7. Monitoring hooks
8. Version v1
9. Auto Execution policy bound to account mode

## 8.4 Bot Anatomy

- Configuration  
- Risk  
- Capital allocation  
- Markets  
- Sessions  
- News Filter  
- Execution policy  
- Logs  
- Analytics  
- Versions  
- Health (heartbeat, error rate, drift, slippage)

## 8.5 Bot Lifecycle

```text
Draft
 → Simulation
 → Backtest
 → Optimization
 → Paper Trading
 → Demo
 → Live
 → Performance Tracking
 → Continuous Learning
 → Rollback (any time)
 → Version History (immutable)
```

**Gates:** لا ترقية لـ Live دون حد أدنى من عيّنة الصفقات/المقاييس + موافقة المستخدم (أو سياسة فريق لاحقًا).

## 8.6 Fleet UX

- بطاقات Health لا بطاقات تسويق
- سبب الإيقاف ظاهر ("news lock", "max DD", "regime mismatch")
- إجراءات جماعية: pause all news-sensitive bots قبل NFP

---

# 9. Strategy Builder (الميزة الكبرى)

## 9.1 فلسفة القسم

لا نخير المستخدم بين Node Editor أو Chat.  
**التجربة واحدة:** Canvas هو المصدر المرئي للحقيقة؛ Chat هو محرّك البناء والتعديل؛ كلاهما يكتب نفس Strategy IR (Intermediate Representation).

## 9.2 AI Strategy Builder (Natural Language)

مثال:
> "أريد سكالبينج على الذهب. EMA20/EMA50. لا تدخل قبل أخبار قوية. مخاطرة 1%. SL = ATR×1.5"

الوكيل يُنتج:
- Rules  
- Workflow graph  
- Risk Engine  
- Session/News constraints  
- Backtest plan  
- Live Strategy package  

ثم يسأل فقط الفجوات الضرورية (مثل: RR المستهدف، أقصى صفقات/يوم).

## 9.3 Strategy Canvas

Blocks قابلة للسحب والربط:

`Market → Trend → Liquidity → Pattern → News → Risk → Entry → Exit → Execution`

خصائص:
- كل Block يعرض إثباتًا (كيف يُقاس)
- AI يمكنه بناء Canvas كامل من "ابنِ ICT"
- المستخدم يعدّل بصريًا أو بالكلام ("احذف شرط EMA50")
- Validation فوري: حلقات مكسورة، تعارض فلاتر، RR غير مجدٍ بعد التكلفة

## 9.4 AI Strategy Chat

محادثة مربوطة بـ `strategy_id`:
- "لماذا لم تدخل؟" → "السبريد 3.1 > 2.5" / "خبر USD بعد 12 دقيقة" / "العائد المتوقع 0.8R بعد التكلفة"
- تعتمد على Debugger + Decision Trace لا على تخمين

## 9.5 Backtest Intelligence

ليس جدول مقاييس أصم. الوكيل يقول:
- Win Rate, Profit Factor, Expectancy  
- أفضل جلسة / أسوأ أيام / أفضل رمز  
- أكبر سبب خسارة (مثل Fake Breakout)  
- اقتراح تحسين قابل للتطبيق: "فلتر الأخبار → رفع متوقع إلى 68% **مع تحذير حجم العيّنة**"

يمنع اختراع نسب بلا دليل (متوافق مع عقيدة "لا ادعاء إحصائي بلا دليل").

## 9.6 AI Optimizer (Layer 4)

أمر: "حسّن هذه الاستراتيجية"  
يجرّب ضمن فضاء محدود: ATR, EMA, RR, Session, Risk…  
يُرجع أفضل Version مع:
- مقارنة Equity/DD  
- Fragility score  
- ما الذي تغيّر ولماذا  
- هل التحسين Overfit؟

## 9.7 Strategy Versions (Git-like)

`v1 → v2 → v3`  
- كل تغيير commit مع رسالة بشرية + diff قواعد  
- Compare أي نسختين  
- Rollback فوري للـ Live Brain  
- ربط كل صفقة بالنسخة التي أنتجتها

## 9.8 Strategy DNA

بصمة متعددة الأبعاد:
`Trend · Liquidity · Momentum · Risk · Time · News · Structure`

استخدمات:
- بحث: "كل الاستراتيجيات التي تشبه ICT بنسبة ≥ 80%"
- Marketplace clustering
- منع تكرار التعرض لنفس الـ DNA في Portfolio

## 9.9 Live Strategy Brain

الاستراتيجية مدير حي يسأل باستمرار:
- هل النظام مناسب؟
- هل يجب الإيقاف؟
- هل نقلّل المخاطر؟
- هل ننتظر خبرًا؟
- هل تغيّر Regime؟

حالات: `active | reduced_risk | paused_news | paused_regime | retired`

---

# 10. Research Center

## 10.1 الهدف

مكان واحد لتجميع الأدلة السياقية قبل وبعد القرار (Layer 6).

## 10.2 مصادر (موحّدة في UX)

Forex Factory · Trading Economics · COT · FRED · Central Banks · X/Twitter · Reddit · RSS · SEC · Crypto News · Whale Alerts · Economic Calendar · On-chain · Correlations · Volatility · Options · Order Flow · Historical Cases · User Documents · AI Summary · Sentiment

## 10.3 UX

- **Source Rail** + **Canvas Report** + **Evidence Chips** التي يمكن إضافتها لحزمة قرار
- Deep Analysis job = timeline تقدّم + نتائج قابلة للربط بتوصية
- لا يُظهر "Buy" من البحث وحده؛ يعيد الحق لـ Layer 2

---

# 11. Recommendations Screen (vNext = Decisions Detail)

شاشة القرار لم تعد بطاقة إشارة. هي **غرفة عمليات القرار**:

| منطقة | المحتوى |
|---|---|
| Header | Symbol, Direction, Plan Type, Execution State, Confidence |
| Chart Dock | مناطق الدخول/الوقف/الأهداف + invalidation |
| Evidence Panel | أبعاد الأدلة + freshness + cost |
| Memory Strip | "رأيت هذا السيناريو…" |
| News/Calendar | النوافذ المؤثرة |
| Similar Cases | أقرب الحالات مع النتائج |
| Execution | جودة التنفيذ، السبريد، الوضع Auto/Recommend |
| Risk | حجم مقترح، أثر المحفظة |
| Probability | إطار احتمالي صريح أو "غير متوفر" |
| AI Explanation | Coach narrative من Trace |
| Decision Trace | خطوات التفكير القابلة للتدقيق |
| Revision History | vN timeline مع diffs |
| Actions | Approve / Execute / Edit conditions / Convert to Strategy/Bot / Dismiss |

---

# 12. Risk Center

## 12.1 الدور

سلطة الحدود — ليست شاشة إحصاءات.

## 12.2 Capabilities

- Account risk caps, daily loss, max positions, max correlated exposure  
- News locks, session locks  
- Strategy/Bot kill switches  
- Portfolio heat  
- Breach timeline + forced reduce suggestions from Portfolio AI  
- Simulation: "ماذا لو شغّلت 3 بوتات ذهب معًا؟"

## 12.3 UX

- وضع Risk Workspace  
- شريط دائم أحمر/كهرماني/هادئ في كل الشاشات  
- كل رفض تنفيذ يعرض **رمز سبب المخاطر** قابل للنقر

---

# 13. Portfolio

## 13.1 يشمل

Accounts · Brokers · Live Trades · Orders · PnL · Exposure · Statistics · Drawdown · Calendar · Allocations across Strategies/Bots · Tax export (مرحلة لاحقة)

## 13.2 قرارات Portfolio AI (أمثلة)

- إيقاف Strategy X اليوم بسبب correlation مع مركز مفتوح  
- تقليل حجم Bot Y بعد تجاوز heat  
- إعادة توزيع رأس المال من DNA متشابه إلى DNA متنوع  

## 13.3 UX

- Overview calmly dense  
- Drill-down حسب Account → Strategy → Trade  
- لا بطاقات زائدة؛ جداول قوية + heatmaps + equity

---

# 14. Journal الذكي

يُنشأ تلقائيًا من Decision Trace + Outcomes:

- لماذا دخلت؟  
- لماذا خرجت؟  
- هل التزمت بالخطة؟  
- أين انحرفت؟  
- ماذا تتعلم؟  

المستخدم يضيف ملاحظة بشرية فقط عند الحاجة.  
Journal يغذّي Atlas وTrading DNA السلوكي.

---

# 15. Analytics Dashboard

طبقات التحليلات:
- Performance (account / strategy / bot)  
- AI quality (calibration, revision rate, explainability coverage)  
- Markets (where edge exists)  
- Execution (slippage, rejects, stale revision denials)  
- Costs  
- Win Rate / Expectancy  
- Heatmaps (session × symbol × strategy DNA)

Analytics تُقرأ؛ لا تُغيّر القرار مباشرة. Optimizer يستهلكها كإشارات عمل.

---

# 16. Atlas / Memory

## 16.1 ما هو Atlas؟

طبقة المعرفة طويلة المدى للمنصة — واجهة Memory + Tutor + Playbooks.

## 16.2 أنواع الذاكرة

- Trading Memory  
- Strategy Memory  
- User Behavior / Preferred Style  
- Mistakes & Wins  
- Playbooks  
- Favorite Markets  
- Historical Cases  
- Lessons Learned  

## 16.3 Case Card UX (الشكل المطلوب)

```text
┌ Case Match ─────────────────────────────┐
│ Scenario: London sweep → displacement     │
│ Observed: 184 times                       │
│ Base win: 71%                             │
│ If high-impact news: 48%                  │
│ If London session: 78%                    │
│ If spread > 2.5: edge negative            │
│ [Use as prior] [Open similar trades]      │
└───────────────────────────────────────────┘
```

تظهر في: Decision Detail, Workspace Evidence, Copilot answers, Bot Debugger.

---

# 17. Marketplace

## 17.1 النموذج

مثل GPT Store لكن لأصول تداول قابلة للتحقق:
- Strategies  
- Bots  
- Indicators  
- Prompts  
- Templates  
- (لاحقًا) Playbooks

## 17.2 بطاقة الأصل

Performance · Sharpe · Max DD · Followers · DNA tags · Sample size · Last audited backtest · Live track record (إن وُجد) · Visibility: Private / Unlisted / Public · License

## 17.3 قواعد ثقة

- لا ترتيب حسب وعود تسويقية  
- الشفافية الإحصائية أولاً  
- One-click: Follow → Paper → Own capital (بسياج مخاطر المستخدم)

---

# 18. Database Modules (Conceptual)

> وحدات منطقية — لا مخطط SQL نهائي هنا.

1. **Identity & Tenancy** — users, sessions, preferences  
2. **Broker & Accounts** — connections, balances, modes  
3. **Market Data Cache** — candles, ticks summaries, calendars  
4. **Market Intelligence Events** — L1 events stream  
5. **Evidence Bundles** — immutable snapshots + hashes  
6. **Decisions / Recommendations** — canonical + revisions + transitions + outcomes  
7. **Decision Traces** — role transitions, tool calls, rationales (bounded)  
8. **Strategies** — IR, canvas graphs, versions, DNA  
9. **Backtests & Optimizations** — jobs, artifacts, comparisons  
10. **Bots** — configs, lifecycle state, health, versions  
11. **Execution** — intents, orders, fills, guards audits  
12. **Portfolio Snapshots** — exposure, allocations  
13. **Risk Policies & Breaches**  
14. **Research Jobs & Sources**  
15. **Journal Entries**  
16. **Atlas Memory** — semantic memories, cases, lessons, playbooks  
17. **Analytics Rollups**  
18. **Marketplace Listings & Entitlements**  
19. **Notifications**  
20. **Audit / Telemetry** (secret-redacted)

---

# 19. Backend Services (Conceptual)

| Service | المسؤولية |
|---|---|
| **Gateway / API** | Auth, tenancy, surface routing |
| **Unified Agent Runtime** | roles, tools, prompts/skills, conversation state |
| **Evidence Service** | assemble/freeze bundles |
| **Decision Engine** | L2 brain, revisions, traces |
| **Market Intelligence Service** | L1 detectors + radar ranking |
| **Strategy Service** | IR, canvas, versions, DNA |
| **Research Service** (موجود كاتجاه) | deep analysis, deterministic backtests |
| **Optimization Workers** | param search, fragility |
| **Bot Orchestrator** | lifecycle, scheduling, health |
| **Execution Service** | intents + guards + broker adapters |
| **Portfolio/Risk Service** | exposure, limits, heat |
| **Memory / Atlas Service** | recall/write, cases |
| **Notification Service** | web, telegram, push |
| **MCP Adapter** | remote brain protocol |
| **Analytics Pipeline** | rollups, calibration |

**قاعدة ذهبية:** كل الأسطح تستدعي هذه الخدمات؛ لا منطق قرار داخل واجهة أو داخل MCP client.

---

# 20. Frontend Structure (Conceptual)

```text
apps/web
  /command
  /workspace          ← Trading IDE shell
  /radar
  /decisions
  /strategies
      /[id]/canvas
      /[id]/chat
      /[id]/versions
  /bots
  /portfolio
  /research
  /atlas
  /marketplace
  /settings

shared
  agent-sdk (client bindings only)
  design-system (AiChart identity)
  charts
  evidence-widgets
  decision-widgets
```

Workspace = shell ثابت؛ باقي الصفحات deep-linkable وتستطيع "Open in Workspace".

---

# 21. Mobile Experience

## 21.1 فلسفة الموبايل (منفصلة عن الديسكتوب)

الموبايل **ليس** نسخة مصغّرة من IDE. هو:
- Brief  
- Radar  
- Decision approve/reject  
- Positions  
- Bot health  
- Push-driven Copilot  

## 21.2 Mobile IA

1. Home Brief  
2. Radar  
3. Decisions (swipe actions)  
4. Positions  
5. Bots (status + pause)  
6. Chat with Agent  
7. More: Portfolio summary, Journal, Settings  

## 21.3 ما لا نضعه على الموبايل في v1

- Strategy Canvas الكامل  
- Optimizer المكثّف  
- Debugger المعقّد  

بدلها: "Continue on Desktop" deep links.

---

# 22. Desktop Experience

## 22.1 فلسفة الديسكتوب

سطح القوة = Workspace IDE + شاشات العمق (Strategy/Research/Analytics).

مستويات الكثافة:
- **Focus:** قرار واحد  
- **Standard:** IDE  
- **God Mode:** multi-chart + fleet + radar sidekick  

## 22.2 هوية بصرية (مبادئ، لا ثيم جاهز مكرر)

- Premium terminal calm — Bloomberg density × Linear clarity × Cursor agent presence  
- هوية خاصة AiChart: إشارية واضحة للـ Evidence/Decision states، لا تقليد TradingView الأخضر/أحمر الافتراضي ككل اللغة البصرية  
- تجنّب أنماط AI المكررة (بنفسجي افتراضي، كروت مفرطة، pills عشوائية)  
- Motion وظيفي: انتقال Role، تجميد Evidence، ترقية Bot lifecycle، Revision pulse  

## 22.3 Desktop-only power features

- Multi-window workspaces  
- Command Palette شامل  
- Compare versions side-by-side  
- Canvas editing  
- Fleet bulk operations  

---

# 23. Implementation Order + What slips to v2

## 23.1 مبادئ التنفيذ

1. وحّد العقل والأسطح قبل توسيع الميزات.  
2. ابنِ Objects الحية (Decision, Strategy, Bot) قبل Marketplace.  
3. كل مرحلة يجب أن تُغلق حلقة Observe→Decide→Learn ولو جزئيًا.

## 23.2 Ordered Roadmap

### Phase A — OS Foundation (يجب أولًا)
- تأكيد Unified Agent عبر Web/MCP/Telegram (تكافؤ سلوكي)
- Information Architecture الجديدة + Command + Decisions shell
- Evidence/Revision/Trace ظاهرة في UX القرار
- Execution modes واضحة

### Phase B — Workspace IDE
- Left/Center/Right/Bottom shell
- Proactive Analyst brief عند فتح الرمز
- Debugger "why no entry"
- Workspaces: Trader + Research

### Phase C — Strategy Builder v1
- NL → Strategy IR
- Canvas أساسي + Chat مربوط
- Versions
- Backtest Intelligence (شرح + اقتراح)

### Phase D — Bots v1
- Create from Strategy/NL
- Lifecycle إلى Paper/Demo
- Health + Logs
- Promote to Live behind risk gates

### Phase E — Intelligence Expansion
- Market Intelligence L1 event stream
- Market Radar L8
- Similar Cases + Memory quote UX
- Optimizer v1

### Phase F — Portfolio AI + Risk Center UX
- Exposure, heat, pause recommendations
- Risk workspace mode

### Phase G — Research Center unification
- Sources hub + report binding to decisions

### Phase H — Atlas + Journal intelligence
- Case cards, tutor, auto journal

### Phase I — Marketplace v1
- Publish strategies/bots/templates with proofs

### Phase J — Mobile v1
- Brief/Radar/Decisions/Positions/Bots pause/Chat

## 23.3 يؤجَّل إلى v2 (بوعي)

- Community الاجتماعية الكاملة (ideas feed, social graph)
- Team Workspace / permissions / audit enterprise
- Tax center الكامل
- Custom Python/TypeScript bots sandbox غير المقيّد (في v1: templates + visual/IR فقط أو sandbox محدود جدًا)
- God Mode multi-window المتقدم
- Marketplace payments/licensing المعقّد (v1: publish/follow/private)
- Indicators marketplace الواسع
- On-chain/options depth الكامل لكل الأسواق
- AI Tutor المنهجي كمسار تعليمي طويل

## 23.4 Explicit cuts (نعم، نحذف من المنتج الذهني القديم)

| عنصر قديم كصفحة مستقلة | القرار |
|---|---|
| Agents (كـ Nav لكائنات عقول) | حذف — يُستبدل بأدوار + Bots |
| AI Analyst page | دمج في Decisions/Copilot |
| Trade Ideas منفصلة عن Recommendations | دمج في Radar → Decisions |
| Live Trades كجزيرة | دمج في Portfolio + Workspace Orders |
| Community في v1 | تأجيل |
| تعدد عقول/Agents منطقية | مرفوض معماريًا |

---

# Appendix A — Design Principles Checklist (Product QA)

- [ ] هل يمكن للمستخدم إنجاز البناء→الاختبار→النشر دون مغادرة AiChart؟  
- [ ] هل نفس القرار يظهر بنفس العقد عبر Web وMCP؟  
- [ ] هل كل توصية تفسَّر من Evidence + Trace + Revision؟  
- [ ] هل Radar يقول "مهم الآن" لا "Buy الآن"؟  
- [ ] هل الاستراتيجية قادرة على Pause نفسها عند Regime/News؟  
- [ ] هل الذاكرة تظهر كـ Case Card رقمي لا كشعر AI؟  
- [ ] هل الموبايل مصمّم كسطح قرارات لا كـ IDE فاشل؟  
- [ ] هل Marketplace يعرض عيّنة ودليلًا لا وعودًا؟  

---

# Appendix B — One-sentence pitch

**AiChart هو نظام تشغيل التداول بالذكاء الاصطناعي: وكيل واحد يراقب السوق، يبني الاستراتيجيات، يختبرها، يحرّك البوتات، ينفّذ بحكمة، ويشرح ويتعلّم — داخل تجربة موحّدة لا تحتاج أدوات خارجية.**

---

*End of Product Specification v1.0 — Design only. Next step after approval: UX wireframes for Workspace + Decisions + Strategy Builder, then Phase A engineering breakdown.*
