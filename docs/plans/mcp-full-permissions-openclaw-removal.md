# MCP صلاحيات كاملة + إزالة OpenClaw

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/mcp_full_permissions_+_openclaw_removal_4b8cc98f.plan.md`](./originals/mcp_full_permissions_%2B_openclaw_removal_4b8cc98f.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| توسيع MCP (~48+ أداة) | kill-switch, binance connect, charts, maintenance, telegram menu |
| Bridge routes جديدة | mt/connect, settings PATCH, binance DELETE |
| OpenClaw decommission | سكربتات + `OPENCLAW_ENABLED=0` + حذف UI |
| Telegram | outbound فقط — لا محادثة OpenClaw |
| AGENTS.md | MCP-first |

## الهدف

Claude MCP = القناة الأساسية؛ OpenClaw يُزال من VPS مع بقاء Risk Guard.

## قائمة مهام

- [x] bridge-routes
- [x] mcp-tools-expand
- [x] agents-docs
- [x] openclaw-noop
- [x] vps-decommission
- [x] vps-deploy-verify
