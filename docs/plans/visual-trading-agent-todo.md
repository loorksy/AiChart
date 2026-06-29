# AiChart Visual Trading Agent — تنفيذ الخطة

هذه قائمة متابعة تنفيذية لتطوير AiChart إلى وكيل تداول بصري مدمج مع الشارت والدردشة وMT5.

## الحالة المنجزة في هذه الحزمة

- [x] إنشاء تحويل Trade Plan إلى رسومات شارت احترافية: Risk/Reward، Entry، SL، TP، وسهم سيناريو.
- [x] تشديد `liveReasoningLog` في LLM schema ليشمل الثقة والربط بالرسم.
- [x] تمرير سجل التحليل الحي إلى طبقة الشارت في شاشة السوق.
- [x] حفظ/استرجاع سجل التحليل الحي ضمن تحليلات المحادثة.
- [x] إنشاء أنواع وسياسة وسجل مبدئي للبطاقات التفاعلية.
- [x] إنشاء مكونات بطاقات: تحليل، سجل حي، نموذج، خطة صفقة، عائد/مخاطرة، تذكرة MT5، مركز، ملخص رسم.
- [x] إنشاء skeleton لتخطيط سطح المكتب والموبايل وتبويبات الرموز.
- [x] إنشاء mapper من `ChartDrawing` إلى MT5 drawing objects.
- [x] إنشاء queue helper وAPI لإرسال/مسح رسومات AiChart على MT5.

## التالي بعد هذه الحزمة

- [ ] دمج `TradingCardRenderer` داخل `chat-message` ومسار `ui_schema` الحالي.
- [ ] ربط أزرار البطاقات بـ action handlers فعلية داخل الدردشة والشارت.
- [ ] تحديث EA `AiChartBridge.mq5` لتنفيذ أوامر الرسم الجديدة: `apply_trade_plan_drawings` و`clear_aichart_drawings`.
- [ ] إضافة migration/normalizer للرسومات القديمة المحفوظة بدون time anchors.
- [ ] إضافة highlight فعلي للرسم عند الضغط على سجل التحليل الحي أو Pattern Card.
- [ ] إضافة اختبارات وحدات لـ `tradePlanToDrawings`, `mt5DrawingMapper`, و`selectTradingCards`.
- [ ] تشغيل `npm install`/إصلاح lockfile في البيئة ثم تشغيل lint/typecheck كامل.
