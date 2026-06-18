# MCP Persistent OAuth — JWT 365 يوم + refresh

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/mcp_persistent_oauth_57334cca.plan.md`](./originals/mcp_persistent_oauth_57334cca.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| JWT access token (365 يوم) | `mcp/src/auth/jwt.ts`, `provider.ts` |
| refresh tokens في SQLite/PostgreSQL | جداول `mcp_oauth_*` |
| OAuth clients persistent | `clientStore.ts` |
| Claude يبقى متصلاً بعد pm2 restart | ✓ |

## المشكلة

OAuth في الذاكرة (1h) — `pm2 restart` يفقد tokens/clients → Claude يفشل في `tools/call`.

## قائمة مهام

- [x] db-schema
- [x] mcp-jwt-db
- [x] provider-refactor
- [x] config-deploy
- [x] vps-deploy-test
