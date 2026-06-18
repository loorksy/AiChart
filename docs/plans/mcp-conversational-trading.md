# التداول المحادثي عبر MCP

> **الحالة:** منفّذ  
> **التاريخ:** 2026-06  
> **النسخة الكاملة:** [`originals/mcp_محادثة_وتداول_cff2ac22.plan.md`](./originals/mcp_محادثة_وتداول_cff2ac22.plan.md)

---

## نتيجة التنفيذ

| البند | النتيجة |
|-------|---------|
| تعطيل مراقبة 24/7 التلقائية | `AGENT_WAKE_ENABLED=0` |
| `get_account_overview` | risk + portfolio + live |
| AGENTS.md — صيغة «ندخل» | موكّل مشترك، سؤال زوج/مبلغ |
| MCP_CLAUDE_SETUP | Project Instructions عربية |
| rationale validation | اختياري في `trade/open` |

## الهدف

Claude وكيل **موكّل** في المحادثة — لا تنفيذ تلقائي 24/7؛ قرار مشترك + Risk Guard.

## قائمة مهام

- [x] disable-agent-wake
- [x] mcp-tool-descriptions
- [x] agents-md-conversational
- [x] mcp-claude-docs
- [x] optional-rationale-validation
- [x] vps-deploy-verify
