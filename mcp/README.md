# AiChart MCP Server

MCP Server يغلّف Bridge API (`/api/agent/*`) للربط مع **Claude.ai → Customize → Connectors → Add custom connector**.

## متغيرات البيئة

| المتغير | مطلوب | الوصف |
|---------|--------|--------|
| `AICHART_API_URL` | نعم | مثل `http://127.0.0.1:3010` |
| `AICHART_SERVICE_TOKEN` | نعم* | نفس توكن جسر OpenClaw |
| `MCP_PUBLIC_URL` | نعم | `https://aichart.lork.cloud/mcp` |
| `MCP_AUTH_SECRET` | نعم* | `openssl rand -hex 32` — نفس القيمة في `web/.env` |
| `MCP_PORT` | لا | افتراضي `8787` |
| `MCP_AUTH_MODE` | لا | `oauth` (افتراضي) أو `none` للتطوير |
| `MCP_ALLOWED_HOSTS` | لا | `aichart.lork.cloud` |

\* غير مطلوب عند `MCP_AUTH_MODE=none` (تطوير فقط).

## تشغيل محلي

```bash
cd mcp
npm install
npm run build

# من web/.env — export المتغيرات ثم:
npm run dev
# أو
node dist/index.js
```

Health: `GET http://127.0.0.1:8787/health`

## Claude Connectors

1. **Name:** `AiChart Trading`
2. **Remote MCP server URL:** `https://aichart.lork.cloud/mcp`
3. OAuth Advanced: اتركه فارغاً (DCR تلقائي)
4. عند أول اتصال: تسجيل دخول admin AiChart

راجع [`docs/MCP_CLAUDE_SETUP.md`](../docs/MCP_CLAUDE_SETUP.md).

## VPS

```bash
bash infra/vps-mcp-deploy.sh /opt/aichart
# أضف infra/nginx/aichart-mcp.conf إلى nginx vhost
```

## الأدوات (19)

`get_risk_status`, `get_market_snapshot`, `get_market_price`, `get_market_context`, `scan_market`, `get_portfolio`, `get_open_trades`, `get_trade_lessons`, `create_recommendation`, `open_trade`, `close_trade`, `evaluate_trade`, `record_exit_decision`, `request_approval`, `respond_approval`, `get_execution_env`, `set_execution_env`, `set_trading_mode`, `set_kill_switch`

Resource: `aichart://trading-rules`
