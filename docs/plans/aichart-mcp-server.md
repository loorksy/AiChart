# AiChart MCP Server — التداول من Claude Connectors

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06 (أول نشر MCP)  
> **النسخة الكاملة:** [`originals/aichart_mcp_server_a22e8a69.plan.md`](./originals/aichart_mcp_server_a22e8a69.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| حزمة `mcp/` مستقلة | منفّذ — Streamable HTTP + OAuth 2.1 PKCE |
| ~19 أداة MCP | تغليف `/api/agent/*` |
| مصادقة Claude | OAuth + `POST /api/admin/mcp-auth/verify` |
| نشر VPS | nginx + pm2 `aichart-mcp` |
| توثيق | [`docs/MCP_CLAUDE_SETUP.md`](../MCP_CLAUDE_SETUP.md) |

## الهدف

استبدال OpenClaw كواجهة محادثة + أدوات تداول عبر Claude.ai Connectors → MCP → Bridge API → Risk Guard → Binance/MT5.

## قرارات رئيسية

- **Streamable HTTP** (ليس stdio) — مطلوب لـ Connectors
- **OAuth 2.1** — Claude لا يدعم Bearer ثابت
- Bridge auth داخلياً عبر `AICHART_SERVICE_TOKEN`
- OpenClaw يُوقَف لاحقاً؛ `web/` يبقى مصدر التنفيذ

## قائمة مهام

- [x] scaffold-mcp
- [x] mcp-tools (~19 أداة)
- [x] streamable-http
- [x] oauth-minimal
- [x] admin-verify-api
- [x] infra-deploy
- [x] docs-claude
- [x] smoke-test
