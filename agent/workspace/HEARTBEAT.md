# HEARTBEAT — مُهمَل (MCP محادثة)

> القرارات تتم في محادثة Claude MCP — لا نبضة تلقائية ولا `[EVENT:…]`.

## ما يبقى تلقائياً (كود فقط)

- صيانة OCO/journal: `runCronPostScan` ضمن `/api/cron/event-monitor`
- Risk Guard: حدود خسارة يومية/شهرية
- post-mortem: درس تلقائي بعد إغلاق كل صفقة → `get_trade_lessons`
- ملخص تيليجرام يومي (outbound): `/api/cron/daily-summary`

## مراجعة الصفقات

عند طلب المشغّل في Claude: «راجع صفقاتنا» → `get_open_trades` → `evaluate_trade`.
