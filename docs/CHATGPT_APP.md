# ربط AiChart بـ ChatGPT (MCP App)

خادم MCP: `https://aichart.lork.cloud/mcp` — نفس الخادم يخدم Claude وChatGPT
بنفس الأدوات (65) والبطاقات التفاعلية.

## الربط الفوري (Developer Mode)

1. ChatGPT → **Settings → Apps & Connectors → Advanced → Developer mode** (فعّله).
2. **Create app / Add connector** → MCP Server URL: `https://aichart.lork.cloud/mcp`
   - Authentication: **OAuth** (يكتشف ChatGPT الإعدادات تلقائياً عبر
     `/.well-known/oauth-protected-resource/mcp` ويسجّل عميلاً عبر `/register` — DCR مفعّل).
3. ستُفتح صفحة تسجيل دخول AiChart → أدخل بريدك وكلمة المرور → موافقة.
4. في محادثة جديدة فعّل التطبيق وجرّب: «أعطني سنابشوت EURUSD» — تظهر بطاقة تفاعلية.

## ما يعمل من ChatGPT

- كل أدوات السوق والحساب والصفقات وMT5 (عبر جسر EA الخاص بالمستخدم).
- البطاقات التفاعلية (`text/html+skybridge` + `window.openai`): نظرة الحساب،
  سنابشوت السوق، الصفقات المفتوحة (إغلاق **مع تأكيد**)، بطاقة التوصية، بطاقة الرسم.
- `run_market_analysis` + `draw_on_chart`: يحلّل ويرسم على شارت المستخدم الحي
  (aichart.lork.cloud/chart/…) — الشارت المفتوح يلتقط الرسم خلال ~4 ثوانٍ.

## قائمة جاهزية النشر في متجر ChatGPT Apps

- [x] MCP Streamable HTTP + OAuth 2.1 (PKCE) + **Dynamic Client Registration**
- [x] `structuredContent` + بطاقات skybridge للأدوات الرئيسية
- [x] Annotations سليمة لكل أداة (readOnly/destructive/idempotent)
- [x] سياسة خصوصية منشورة: `https://aichart.lork.cloud/privacy`
- [x] جهة دعم: loorksy@gmail.com
- [ ] **خطوة المالك**: تقديم التطبيق للمراجعة من لوحة OpenAI
      (Apps & Connectors → Submit for review) مع الاسم/الشعار/الوصف ولقطات الشاشة.
- ملاحظات مراجعة متوقعة: أدوات التداول موسومة destructive وتُنفَّذ فقط بعد
  موافقة المستخدم (وضع approval في المنصة + بطاقات «تنفيذ مع تأكيد»).

## استكشاف أعطال

- 401 عند الربط: أعد تسجيل الدخول — الجلسة تُدار بتوكن JWT (TTL يتبع صلاحية حسابك).
- «EA غير متصل» من أدوات MT5: شغّل MetaTrader مع AiChartBridge EA على جهازك.
- البطاقة لا تظهر: تأكد أن ChatGPT محدث ويدعم Apps SDK؛ النص يبقى متاحاً دائماً.
