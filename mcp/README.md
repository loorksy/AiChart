# AiChart MCP Server

MCP Server يغلّف Bridge API (`/api/agent/*`) للربط مع **Claude.ai → Customize → Connectors → Add custom connector**.

**Version:** 1.1.0 — see [`CHANGELOG.md`](CHANGELOG.md).

## متغيرات البيئة

| المتغير | مطلوب | الوصف |
|---------|--------|--------|
| `AICHART_API_URL` | نعم | مثل `http://127.0.0.1:3010` |
| `AICHART_SERVICE_TOKEN` | نعم* | توكن جسر `/api/agent/*` — نفس القيمة في `web/.env` |
| `MCP_PUBLIC_URL` | نعم | `https://aichart.lork.cloud/mcp` |
| `MCP_AUTH_SECRET` | نعم* | `openssl rand -hex 32` — نفس القيمة في `web/.env` |
| `MCP_PORT` | لا | افتراضي `8787` |
| `MCP_AUTH_MODE` | لا | `oauth` (افتراضي) أو `none` للتطوير |
| `MCP_ALLOWED_HOSTS` | لا | `aichart.lork.cloud` |
| `MCP_ACCESS_TOKEN_TTL_DAYS` | لا | افتراضي `365` |
| `MCP_REFRESH_TOKEN_TTL_DAYS` | لا | افتراضي `365` |
| `DB_PATH` | لا | SQLite لـ OAuth tokens (افتراضي `data/aichart.db`) |

\* غير مطلوب عند `MCP_AUTH_MODE=none` (تطوير فقط).

### Bridge-related (on **web** `.env`, affects MCP tool responses)

| Variable | Default | Purpose |
|----------|---------|---------|
| `STALE_QUOTE_MS` | 5000 | Quote freshness threshold |
| `MAX_SPREAD_PIPS` | 30 | Forex spread pre-flight reject |
| `BRIDGE_RATE_LIMIT_WRITES` | 10 | Agent write rate limit per route/min |
| `IDEMPOTENCY_TTL_HOURS` | 24 | `open_trade` idempotency TTL |
| `BRIDGE_CACHE_TTL_MS` | 5000 | In-memory bridge cache default |
| `FOREX_BACKEND` | metaapi | `metaapi` \| `mt5local` |

## تشغيل محلي

```bash
cd mcp
npm install
# Windows if native deps fail:
# npm install --ignore-scripts
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

راجع هذا الملف وقسم Claude MCP في [`README.md`](../README.md).

## VPS

```bash
bash infra/vps-mcp-deploy.sh /opt/aichart
# أضف infra/nginx/aichart-mcp.conf إلى nginx vhost
pm2 restart aichart-web aichart-mcp
```

Smoke:

```bash
curl -fsS https://<domain>/health   # {"ok":true,"service":"aichart-mcp",...}
```

## الأدوات (1.1 highlights)

**New:** `get_trade_readiness`, `get_ohlc`, `get_forex_indicators`, `detect_levels`, `request_ea_reconnect`

**Enhanced:** `get_ea_live_quotes` (freshness), `open_trade` (envelope + idempotency + confidence gate), `capture_mt5_chart` (inline PNG), `get_agent_capabilities` (feature flags)

**Resource:** `aichart://trading-rules`

Full list: ~53 tools in `mcp/src/tools/`.
