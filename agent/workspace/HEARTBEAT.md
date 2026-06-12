# مراقبة Event-Driven (بدون نبض دوري)

النبض الدوري (heartbeat) **معطّل**. المراقبة 24/7 تتم بالكود عبر `monitorRunner.ts` و cron:

`POST /api/cron/event-monitor` — كل 10 دقائق (كود فقط، بدون AI).

## متى يصلك حدث على تيليجرام

| الوسم | المعنى | ماذا تفعل |
|-------|--------|-----------|
| `[EVENT:market_candidate]` | إشارات فنية قوية على رمز | حلّل، سجّل توصية + شارت إن ≥75%، نفّذ حسب الوضع |
| `[EVENT:trade_alert]` | السعر قريب من SL/TP (≤1.5%) | راجع الأطروحة في الذاكرة؛ أغلق أو عدّل إن انكسرت |
| `[EVENT:daily_loss_warn]` | خسارة اليوم قرب الحد (80%+) | أنذر المشغّل؛ لا صفقات جديدة بلا موافقة |
| `[EVENT:daily_memory]` | بعد الملخص اليومي 20:00 UTC | حدّث `MEMORY.md` و`memory/` |

## قواعد ثابتة عند أي حدث

1. اقرأ `GET /api/agent/risk/status` قبل تنفيذ.
2. Kill Switch مفعّل → لا تنفيذ، أبلغ مرة واحدة.
3. للفوركس قبل التنفيذ: `GET /api/agent/ea/diagnostics?symbol=…`
4. صفقة تجريبية: `practice: true` + `POST /api/agent/approval/request` عند الحاجة.
5. التنبيهات قصيرة؛ مع الشارت عند التوصيات.

## APIs للأحداث

- مسح كود: `POST /api/agent/market/scan`
- صفقات مفتوحة: `GET /api/agent/trades/open`
- صيانة OCO/TP: `POST /api/agent/maintenance` (يُشغّلها الكود تلقائياً)
