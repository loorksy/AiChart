# عزل multi-user كامل — MCP والمنصة

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/multi-user_mcp_isolation_cf083e00.plan.md`](./originals/multi-user_mcp_isolation_cf083e00.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| هوية OAuth → Bridge | `BridgeClient actAsEmail` + HMAC |
| `resolveBridgeUserId(req)` | ~41 route في `/api/agent/*` |
| صيانة per-user | `runUserPostScan(userId)` |
| بوابات المنصة | `requirePlatformAccess`, console gates |
| اختبار عزل | `infra/tmp-test-bridge-isolation.py` |

## المشكلة

MCP كان يمرّر `AICHART_SINGLE_USER` — كل المستخدمين يشاركون حساباً واحداً.

## قائمة مهام

- [x] mcp-bridge-identity
- [x] resolve-bridge-user
- [x] agent-routes-migrate
- [x] maintenance-per-user
- [x] web-platform-gates
- [x] e2e-isolation-deploy

## يرتبط بـ

- [ea-multi-user-audit.md](./ea-multi-user-audit.md) — تقييم EA
- [ea-multi-user-complete.md](./ea-multi-user-complete.md) — hardening EA
