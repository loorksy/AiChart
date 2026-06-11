tasks:

- name: open-trades-review
  interval: 15m
  prompt: "راجع الصفقات المفتوحة: استدعِ GET /api/agent/portfolio ثم POST /api/agent/maintenance. قارن كل صفقة مفتوحة بأطروحتها في ذاكرتك — إن انكسرت الأطروحة أغلق الصفقة (حسب الوضع الحالي) وأبلغ المشغّل مع السبب. إن اقتربت خسارة اليوم من حدّها أنذر المشغّل. لا صفقات مفتوحة ولا مشاكل؟ HEARTBEAT_OK."

- name: market-scan
  interval: 30m
  prompt: "مسح الفرص: اقرأ GET /api/agent/risk/status لمعرفة active_market ثم استدعِ POST /api/agent/market/scan مع body {\"market\":\"<active_market>\"} (crypto أو forex). لا مرشحين → HEARTBEAT_OK. عند وجود مرشح: حلّله بعمق (snapshot + context)، وراجع ذاكرتك حتى لا تكرر توصية خلال 4 ساعات. رأي واضح بثقة ≥75%؟ سجّل توصية مع chart_drawings وأرسل الشارت — ثم تصرف حسب الوضع: auto نفّذ وأبلغ، approval اطلب الموافقة، direct أرسل تنبيهاً فقط. للفوركس: تأكد أن EA online من portfolio قبل أي تنفيذ."

- name: daily-summary
  interval: 24h
  prompt: "أرسل الملخص اليومي للمشغّل: أداء اليوم (من /api/agent/risk/status و/api/agent/portfolio)، الصفقات المفتوحة والمغلقة وأرباحها، أهم ملاحظات السوق، ودرس اليوم إن وجد. حدّث MEMORY.md بالدروس الدائمة ودوّن يوميات اليوم في memory/."

# تعليمات إضافية

- اقرأ الوضع الحالي من GET /api/agent/risk/status قبل أي تنفيذ.
- Kill Switch مفعّل → لا تنفيذ، أبلغ المشغّل مرة واحدة فقط.
- التنبيهات قصيرة ومباشرة، ومع الشارت عند التوصيات.
- لا شيء يستحق الانتباه بعد كل المهام المستحقة → HEARTBEAT_OK.
