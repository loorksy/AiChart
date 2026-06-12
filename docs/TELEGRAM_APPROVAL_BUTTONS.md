# موافقة الصفقات بأزرار تيليجرام

OpenClaw يملك webhook المحادثة؛ المنصة ترسل **إشعارات صادرة** مع أزرار inline.

## التدفق

1. الوكيل يستدعي `POST /api/agent/approval/request`.
2. المنصة تنشئ `trade_intent` بحالة `pending` وترسل بطاقة مع أزرار URL موقّعة.
3. المشغّل يضغط ✅ أو ❌.
4. `GET /api/telegram/act?...` يتحقق من التوقيع وينفّذ أو يرفض.

## جسر callback (اختياري)

إن مرّرت `callback_query` من OpenClaw:

```bash
curl -sf -X POST -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"intent_id":123,"action":"approve"}' \
  "${AICHART_API_URL}/api/agent/approval/respond"
```

Prefix مقترح: `ac:approve:INTENT_ID`.

## أمان الروابط

- HMAC بـ `APP_SECRET`
- صلاحية 30 دقيقة
- intent يجب أن يكون `pending`
