# AiChart Agent — Claude MCP

التداول والتحليل عبر **Claude.ai Connectors** + MCP Server في [`mcp/`](../mcp/README.md).

## البنية

```
أنت ←→ Claude (Connectors)
         ↓ MCP
    aichart-mcp → /api/agent/* → Risk Guard → Binance / MT5
```

- **قواعد الوكيل:** [`workspace/AGENTS.md`](workspace/AGENTS.md) (يُقرأ كـ resource `aichart://trading-rules`)
- **مهارة Bridge:** [`workspace/skills/aichart-trading/SKILL.md`](workspace/skills/aichart-trading/SKILL.md)
- **دليل الربط:** [`docs/MCP_CLAUDE_SETUP.md`](../docs/MCP_CLAUDE_SETUP.md)

## متغيرات أساسية (`web/.env`)

| المتغير | الغرض |
|---------|--------|
| `AICHART_SERVICE_TOKEN` | جسر `/api/agent/*` (MCP يستخدمه) |
| `MCP_AUTH_SECRET` | OAuth MCP + web |
| `MCP_PUBLIC_URL` | عنوان Claude Connector |

## Telegram

المنصة ترسل **إشعارات outbound** فقط (تنفيذ، موافقات، ملخص). المحادثة التداولية في **Claude MCP** (بعد موافقة الأدmin).

## المستخدمون

- `AICHART_SINGLE_USER=0` — تسجيل مفتوح؛ الأدmin يوافق من `/console/platform?tab=users`.
- صلاحية افتراضية **30 يوم** (قابلة للتعديل عند الموافقة أو التجديد).

## VPS

```bash
bash infra/vps-mcp-deploy.sh
pm2 restart aichart-web aichart-mcp
```

Cron يبقي صيانة OCO فقط — لا استيقاظ وكيل تلقائي (`AGENT_WAKE_ENABLED` معطّل افتراضياً).
