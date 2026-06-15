# إيقاف OpenClaw — Claude MCP هو القناة الأساسية

بعد تفعيل MCP + Claude Connectors، OpenClaw **اختياري** ويمكن إزالته بالكامل.

## إزالة كاملة (موصى به)

```bash
cd /opt/aichart
bash infra/vps-openclaw-decommission.sh
pm2 restart aichart-web --update-env
bash infra/vps-mcp-deploy.sh
```

السكربت يقوم بـ:

- `pm2 delete aichart-agent`
- حذف `/root/.openclaw` و `/tmp/openclaw` (sessions/jsonl — الأكبر)
- `npm uninstall -g openclaw`
- حذف logs pm2 للوكيل
- `OPENCLAW_ENABLED=0` في `web/.env`
- تعطيل nginx `/openclaw` إن وُجد
- docker volume `openclaw-state` إن وُجد

## ما يتوقف

| الميزة | بعد الإزالة |
|--------|-------------|
| محادثة Telegram التفاعلية | لا — Claude MCP هو القناة |
| `[EVENT:…]` عبر OpenClaw | لا — راجع الصفقات من Claude |
| ذاكرة OpenClaw (`MEMORY.md`) | لا تُحدَّث — استخدم `get_trade_lessons` |

## ما يبقى يعمل

- Bridge API + Risk Guard + Binance/MT5
- **MCP** (`https://aichart.lork.cloud/mcp`) — كل أدوات التداول
- إشعارات Telegram **outbound** (تنفيذ، kill switch، …)
- cron مراقبة (كود فقط — بدون AI)
- لوحة المنصة `/console`

## متغيرات البيئة

```env
OPENCLAW_ENABLED=0
OPENCLAW_AUTO_RESTART=0
```

## Rollback (إعادة OpenClaw)

```bash
cd /opt/aichart
npm install -g openclaw@latest
bash infra/vps-instructions-deploy.sh
bash agent/scripts/sync-workspace.sh
```

## MCP

- URL: `https://aichart.lork.cloud/mcp`
- دليل: [`MCP_CLAUDE_SETUP.md`](MCP_CLAUDE_SETUP.md)
