# خطة إعادة الهيكلة — محرك تداول مستقل عالي السرعة (Hyper-Scalping Engine)

> **الحالة:** مسودة للمراجعة — **لا يوجد أي تعديل على الكود بعد.**
> الهدف: تحويل المنصة إلى محرك تداول لحظي مستقل متعدد الأصول (Crypto عبر Binance + Forex/CFD عبر MT5/MetaApi).

---

## 0) ملخص تنفيذي — أين نحن الآن مقابل المطلوب

| المتطلب | الحالة الحالية | الفجوة |
|---|---|---|
| **1. تكامل ثنائي الأصول (Binance + MT5)** | ✅ موجود بنسبة ~90%. `getBrokerAdapter()` يوجّه حسب `BrokerKind`، وهناك 5 محوّلات: `binanceAdapter`, `binanceFuturesAdapter`, `eaAdapter`, `metaApiAdapter`, `mt5LocalAdapter`. التوجيه حسب السوق عبر `brokerForMarket()`. | تحسينات صغيرة فقط (راجع §1). |
| **2. إطارات زمنية ديناميكية لا نهائية** | ⚠️ جزئي. 13 إطاراً ثابتاً (`MARKET_INTERVALS`)، مؤشرات تُحسب محلياً. 3 طبقات تحليل (`analysisProfile`). | لا يوجد جلب ديناميكي لأي إطار؛ Forex لا يدعم كل الإطارات؛ ناقص 8h/2w/1M. |
| **3. اختيار وضع MCP تفاعلي + حواجز** | ❌ غير موجود. `set_trading_mode` = (auto/approval/direct) وهي *سلطة تنفيذ* وليست *أسلوب تداول* (Scalp/Swing/Day/Position). لا يوجد سؤال تفاعلي ولا سقف صفقات للسكالبينغ. | فجوة حقيقية — راجع §3. |
| **4. دورة حياة الوكيل المستمرة (micro-management لحظي)** | ❌ غير موجود. النموذج الحالي = cron يستيقظ ويوقظ الوكيل عبر Telegram (`runMonitorCycle`). لا توجد حلقة tick-by-tick ولا دورات buy-close-sell-close سريعة. | **أكبر فجوة معمارية** — راجع §4. |
| **5. خطة ملف-بملف** | — | هذا المستند. |
| **6. MetaApi للربط المباشر من المنصة** | ✅ `metaApiAdapter` موجود (مُفعّل بـ `METAAPI_TOKEN`) + مسار ربط `mt/connect`. | تفعيل وتوثيق فقط. |

**الخلاصة:** البنية التحتية للتنفيذ ثنائي الأصول **جاهزة وممتازة**. الجهد الحقيقي ينصبّ على بندين: **(3) اختيار الأسلوب التفاعلي** و**(4) حلقة الوكيل المستمرة** — وهما يحتاجان مكوّناً معمارياً جديداً (worker دائم)، وليس مجرد تعديل ملفات.

---

## 1) التكامل ثنائي الأصول — Binance + MT5

### الوضع الحالي (ملفات أساسية)
- `web/src/lib/brokers/index.ts` — `getBrokerAdapter(kind, marketType)` يختار المحوّل.
- `web/src/lib/brokers/types.ts` — واجهة `BrokerAdapter` (`isConnected`, `placeOrder`).
- `web/src/lib/markets/types.ts` — `brokerForMarket(market)` → binance | mt_ea | metaapi | mt5_local.
- `web/src/lib/execution.ts` — `executeIntent()` هو **البوابة** الوحيدة: Risk Guard ثم تفويض للمحوّل.
- `web/src/lib/brokers/forexBackend.ts` — يحسم backend الفوركس (env → mt5local → metaapi → ea).

### التقييم
التوجيه الديناميكي حسب فئة الأصل **منجز بالفعل**. لا حاجة لإعادة هيكلة طبقة التنفيذ.

### تعديلات مقترحة (طفيفة)
| الملف | التغيير |
|---|---|
| `web/src/lib/brokers/types.ts` | إضافة دوال اختيارية للمحوّل لدعم السكالبينغ: `closePosition(userId, symbol)` و `reversePosition(userId, ctx)` (flip) — حالياً الإغلاق متفرّق في `tradeClose.ts`/أدوات MCP. توحيدها خلف الواجهة يبسّط حلقة §4. |
| `web/src/lib/execution.ts:174` | لا تغيير منطقي — فقط التأكد أن `intent.broker` يُمرَّر دائماً (موجود). |

**لا يوجد عمل جوهري هنا — البند مكتمل عملياً.**

---

## 2) إطارات زمنية ديناميكية + مسح السوق

### الوضع الحالي
- `web/src/lib/intervals.ts` — `MARKET_INTERVALS` = 13 إطاراً ثابتاً (1m…1w) + `barDurationSec()`.
- `web/src/lib/analysisProfile.ts` — `profileForInterval()` → 3 طبقات (intraday/swing/position).
- `web/src/app/api/agent/market/ohlc/route.ts` + `forex-indicators/route.ts` — حساب المؤشرات محلياً.
- المسح: `monitorRunner.ts` → `scanSymbol`/`scanForexSymbol` على `settings.analysis_interval`.

### الفجوة
- "لا نهائي" غير ممكن حرفياً (المنصات تعطي شموعاً بإطارات ثابتة)، لكن يمكن:
  1. توسيع القائمة (إضافة `8h`, `2w`, `1M`).
  2. **اشتقاق إطارات مخصّصة** عبر تجميع (resample) من إطار أساسي (مثلاً 10m من 1m، 45m من 5m).
  3. ضمان تطابق إطارات Binance ↔ MT5 (MT5 يستخدم M1/M5/H1… — يلزم mapping).

### تعديلات ملف-بملف
| الملف | التغيير |
|---|---|
| `web/src/lib/intervals.ts` | إضافة `8h`,`2w`,`1M` للقائمة + خريطة `binance↔mt5` للإطارات. إضافة `resampleOhlc(base, factor)` لاشتقاق إطارات غير قياسية. |
| `web/src/lib/analysisProfile.ts:57` | جعل `profileForInterval` يتعامل مع أي إطار (fallback ذكي حسب مدة الشمعة بدل القائمة الصلبة). |
| `web/src/app/api/agent/market/ohlc/route.ts` | قبول `interval` حر؛ إن لم يكن قياسياً → جلب الأساس + `resampleOhlc`. |
| `web/src/lib/markets/forexSnapshot.ts` | mapping إطار Binance → إطار MT5 المكافئ قبل طلب الـ EA. |

---

## 3) اختيار وضع التداول التفاعلي في MCP + حواجز

### الفجوة (مفهوم مفقود)
النظام الحالي يفصل بين:
- `mode` = **سلطة التنفيذ** (auto/approval/direct) — `lib/types.ts:51`.
- `style` = **شهية المخاطر** (conservative/balanced/aggressive).
- `analysis_interval` = الإطار.

لا يوجد مفهوم **«أسلوب التداول»** (Scalping / Day / Swing / Position) كوحدة واحدة تضبط (الإطار + شهية المخاطر + سقف الصفقات + سرعة الحلقة).

### التصميم المقترح: `trading_style`
إضافة حقل جديد `trading_style: "scalp" | "day" | "swing" | "position"` يربط تلقائياً:
| الأسلوب | الإطار الافتراضي | سرعة الحلقة | سقف الصفقات | TP/SL نموذجي |
|---|---|---|---|---|
| Scalp | 1m–5m | tick / 1–2s | يطلبه المستخدم (cap) | ضيّق جداً |
| Day | 15m–1h | 30–60s | متوسط | متوسط |
| Swing | 4h–1d | دقائق | منخفض | واسع |
| Position | 1d–1w | cron عادي | منخفض جداً | واسع جداً |

### تعديلات ملف-بملف
| الملف | التغيير |
|---|---|
| `web/src/lib/types.ts:49` | إضافة `trading_style` + `scalp_max_trades` (سقف الصفقات المتزامنة للسكالبينغ) إلى `TradingSettings`. |
| `web/src/lib/db/pg.ts` (+ `sqlite.ts`) | migration: عمودان جديدان `trading_style TEXT DEFAULT 'day'`, `scalp_max_trades INTEGER DEFAULT 0`. |
| `web/src/lib/store.ts` | قراءة/كتابة الحقلين في `getSettings`/`updateSettings`. |
| `web/src/app/api/agent/mode/route.ts` | توسيع لقبول `trading_style` (أو مسار جديد `style/route.ts`). |
| `mcp/src/tools/schemas/coreSchemas.ts:214` | أداة جديدة `select_trading_style` (تفاعلية): تُرجع للوكيل قائمة الأساليب وتطلب منه — في حالة `scalp` — استدعاء `set_scalp_cap` بعدد الصفقات. |
| `mcp/src/tools/core.ts:192` | تسجيل الأداتين الجديدتين + ربطهما بالمسار. |
| **`AGENTS.md`** (مورد MCP) | تعليمة: «عند بدء الجلسة، **اسأل المستخدم أولاً** عن أسلوب التداول؛ وفي السكالبينغ اسأل: كم صفقة متتالية تريدني أن أنفّذ؟» — هذا يحقّق «التفاعلية» عبر التوجيه، لأن MCP بروتوكول request/response (الـ prompt هو آلية السؤال). |

> **ملاحظة معمارية:** MCP لا يملك «حلقة تهيئة» تفرض سؤالاً؛ التفاعل يتحقّق بجعل النموذج (Claude في التطبيق) يسأل بناءً على تعليمة `AGENTS.md` + أداة `select_trading_style`. هذا أنظف من فرضه في الكود.

---

## 4) دورة حياة الوكيل المستمرة (أصعب جزء)

### الفجوة الجوهرية
النموذج الحالي **request/response + cron**:
- `monitorRunner.runMonitorCycle()` يُستدعى دورياً (cron) → يمسح → **يوقظ الوكيل عبر Telegram**.
- لا يوجد عملية حيّة تراقب tick-by-tick، ولا دورات buy→close→sell→close سريعة.
- الـ EA يدفع الأسعار كل ~1s (`/api/ea/quotes`)، لكن الويب لا «يستهلكها في حلقة».

### الخيارات المعمارية
**الخيار أ — Scalp Worker دائم (موصى به):**
عملية Node منفصلة (PM2 process جديد `aichart-scalper`) تحمل حلقة `while(active)`:
1. تقرأ المستخدمين في وضع `scalp` نشط.
2. لكل رمز: تسحب أحدث quote (من cache الـ EA / Binance WS).
3. تستدعي «محرّك قرار خفيف» (قواعد + اختياري نداء LLM مُقتصد) → buy / close / reverse / hold.
4. تنفّذ عبر `executeIntent` (نفس البوابة — Risk Guard يبقى الحاكم).
5. تحترم `scalp_max_trades` و kill-switch.

**الخيار ب — تمديد الـ EA نفسه:** نقل منطق السكالبينغ إلى `AiChartBridge.mq5` (أسرع زمن استجابة، لكن يفقد ذكاء LLM ويصعب صيانته).

**الخيار ج — WebSocket loop داخل Next.js:** غير مناسب (Next.js serverless/طلب-استجابة، لا حلقات دائمة موثوقة).

### تعديلات/ملفات جديدة (الخيار أ)
| الملف | التغيير |
|---|---|
| `web/src/lib/scalp/engine.ts` **(جديد)** | المحرّك: `decideScalpAction(quote, position, momentum, profile)` → قرار. منطق الزخم: شمعة صاعدة فورية → BUY؛ انعكاس خلال 2–3 شموع → close + flip إلى SELL. |
| `web/src/lib/scalp/worker.ts` **(جديد)** | حلقة `runScalpLoop()` — tick polling، per-user، تحترم cap/kill-switch/cooldown. |
| `web/src/lib/scalp/momentum.ts` **(جديد)** | مؤشرات لحظية خفيفة (EMA سريع، تغيّر سعري، شمعة حالية) من stream الـ quotes. |
| `web/src/lib/brokers/types.ts` | إضافة `closePosition` + `reversePosition` (راجع §1) لتبسيط flip. |
| `web/src/lib/execution.ts` | دعم وضع تنفيذ «سكالب» يتخطّى أجزاء التوصية الثقيلة لكن **يحتفظ بـ Risk Guard** (لا تخطّي للحدود). |
| `infra/pm2.ecosystem.config.cjs` | تسجيل عملية `aichart-scalper` (entry = `scalp/worker`). |
| `web/src/lib/store.ts` | `listActiveScalpUsers()` + حالة الجلسة (عدد الصفقات المنفّذة مقابل cap). |
| `mcp/src/tools/schemas/coreSchemas.ts` | أدوات `start_scalp_session` / `stop_scalp_session` / `get_scalp_status`. |

### حواجز أمان إلزامية (Guardrails)
- **Risk Guard يبقى البوابة الوحيدة** — أي صفقة سكالب تمرّ عبر `executeIntent` → `evaluateTrade`.
- `scalp_max_trades` يوقف الدورة عند بلوغ السقف.
- `kill_switch` + master-kill يوقفان الـ worker فوراً.
- حدّ أدنى للزمن بين الصفقات لمنع over-trading.
- حدّ خسارة يومي (`daily_loss_limit_pct`) يوقف الجلسة.

---

## 5) ترتيب التنفيذ المقترح (مراحل)

1. **المرحلة 0 (بدون مخاطر):** §2 توسيع الإطارات + §3 حقول `trading_style`/`scalp_max_trades` + migrations + أدوات MCP للاختيار. قابلة للدمج فوراً.
2. **المرحلة 1:** §3 التفاعلية الكاملة (AGENTS.md + select_trading_style) واختبارها يدوياً.
3. **المرحلة 2:** §4 الخيار أ — بناء `scalp/engine.ts` + `momentum.ts` مع **backtest/paper فقط** (لا تنفيذ حقيقي).
4. **المرحلة 3:** ربط `worker.ts` بـ `executeIntent` في وضع demo، ثم live خلف عَلَم صريح.
5. **المرحلة 4:** توثيق MetaApi للربط المباشر من المنصة (§6) — موجود، يحتاج تفعيل `METAAPI_TOKEN` + UI.

---

## 6) MetaApi — الربط المباشر من المنصة
- `web/src/lib/brokers/metaApiAdapter.ts` + `web/src/lib/metaapi/client.ts` جاهزان.
- `forexBackend.ts` يختار metaapi تلقائياً عند وجود `METAAPI_TOKEN`.
- المطلوب: تفعيل التوكن + شاشة ربط (رقم الحساب/كلمة المرور/السيرفر) — مسار `mt/connect` موجود.
- **الميزة:** يلغي حاجة المستخدم لتشغيل EA على جهازه — الربط سحابي من المنصة مباشرة.

---

## 8) جودة استخدام الوكيل لـ MCP — البطء (تشخيص)

### الأسباب (مرتبة حسب الأثر)
1. **لا توجد أداة متعددة الأطر الزمنية** 🔴 — `get_market_snapshot` ([marketSchemas.ts:8](../mcp/src/tools/schemas/marketSchemas.ts)) يقبل إطاراً واحداً. تحليل متعدد الأطر = 3 نداءات متتالية (1h+15m+5m)، كل نداء رحلة كاملة `Claude → MCP(VPS) → bridge → web → Binance/EA`. = 3× زمن.
2. **`get_account_overview` نداء مُجمّع ثقيل** 🔴 — يجمع risk+portfolio+live ([coreSchemas.ts:20](../mcp/src/tools/schemas/coreSchemas.ts)). يعتمد على الحساب الحي؛ يفشل حين يبطؤ مسار EA/الـ quote قديم — بينما النداءات الخفيفة تنجح.
3. **لا timeout في bridge client** 🔴 — [mcp/src/bridge/client.ts](../mcp/src/bridge/client.ts) يستخدم `fetch` بلا `AbortController`؛ أي تأخير upstream يُعلّق النداء حتى تايم-آوت المنصة («الخادم لا يستجيب»).
4. **49 أداة بأوصاف عربية مطوّلة** 🟠 — تضخّم السياق → تطبيق Claude يُسقط أدوات ويعيد البحث عنها (`scan_market` reloaded).

### الإصلاحات
| # | الإصلاح | الملف | الأثر |
|---|---|---|---|
| 1 | أداة `get_multi_timeframe_snapshot` (عدة أطر بنداء واحد) | route جديد + `marketSchemas.ts` | ⭐⭐⭐ |
| 2 | `AbortController` + timeout (~8s) | `mcp/src/bridge/client.ts` | ⭐⭐⭐ |
| 3 | جعل جزء live اختيارياً + استخدام `bridge/cache.ts` (TTL 5s) | route account_overview | ⭐⭐ |
| 4 | تقليص الأوصاف + إخفاء الأدوات النادرة خلف tier | `*Schemas.ts` | ⭐⭐ |

---

## 9) جودة كتابة النتائج — غير مفهومة للمستخدم (تشخيص)

### السبب
أسلوب جلسات MCP محكوم بـ [`agent/workspace/SOUL.md`](../agent/workspace/SOUL.md) (مورد MCP) **وليس** `persona.ts`. و`SOUL.md` يطلب صراحةً: *"Data-Driven: actual figures"* + *"Focus on cold facts, indicators"*، وكل قواعد التنسيق فيه لبطاقات Telegram فقط — **لا قاعدة لرد المحادثة**. النتيجة: أرقام خام (`MACD +0.0000289`)، خلط عربي/إنجليزي، بلا حكم واضح.

### الإصلاح (في SOUL.md — بدون كود)
إضافة قسم «تنسيق رد المحادثة»:
- **الخلاصة أولاً**: حكم واضح في السطر الأول (ادخل/انتظر + السبب المختصر).
- **ترجمة المؤشرات** لمعنى بشري: «الزخم بدأ ينقلب صعوداً» بدل `MACD +0.0000289`.
- **إخفاء الكسور الدقيقة**: لا تعرض `-0.000133` خاماً.
- **لا خلط لغوي** داخل الجملة.
- **بنية ثابتة**: 📊 الخلاصة → 🔍 الأسباب المبسّطة → ✅ التوصية.
- القاعدة الذهبية: **«المستخدم تاجر لا مهندس — اشرح معنى الرقم، لا ترمِ الرقم.»** التفاصيل الرقمية تُعرض فقط عند الطلب.

---

## 7) مخاطر وملاحظات
- **التكلفة:** حلقة سكالب تستدعي LLM بكثرة → مكلفة. الحلّ: محرّك قواعد سريع + نداء LLM فقط عند إشارة قوية، أو نموذج أصغر (Haiku) للقرارات اللحظية.
- **زمن الاستجابة:** الويب→EA→MT5 يضيف تأخيراً؛ السكالبينغ الحقيقي قد يتطلّب منطقاً داخل الـ EA (الخيار ب) للحالات فائقة السرعة.
- **لا تُكسر البوابة:** كل المسارات الجديدة تمرّ عبر `executeIntent`/Risk Guard — هذا غير قابل للتفاوض.
- **التوافق:** migrations يجب أن تدعم pg + sqlite (الملفان موجودان).
