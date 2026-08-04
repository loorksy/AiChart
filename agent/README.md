# Lonora Agent — Claude MCP Bridge

Trading and technical analysis execution using **Claude.ai Connectors** and the MCP Server implemented in [`mcp/`](../mcp/README.md).

---

## 1. System Architecture

```
User ←→ Claude (Connectors Interface)
          ↓ (Model Context Protocol)
     aichart-mcp → /api/agent/* → technical execution safety → MetaTrader 5 (Forex)
```

*   **Agent Rules**: [`workspace/AGENTS.md`](workspace/AGENTS.md) (served as resource `aichart://trading-rules`).
*   **Trading Lexicon**: [`workspace/skills/trading-lexicon/SKILL.md`](workspace/skills/trading-lexicon/SKILL.md) (served as resource `aichart://trading-lexicon`).
*   **Trading Strategies Matrix**: [`workspace/skills/trading-strategies/SKILL.md`](workspace/skills/trading-strategies/SKILL.md) (served as resource `aichart://trading-strategies`).
*   **Connector Setup Guide**: [`mcp/README.md`](../mcp/README.md).

---

## 2. Core Environment Variables (`web/.env` & `mcp/.env`)

| Variable | Purpose |
|----------|---------|
| `AICHART_SERVICE_TOKEN` | Auth token securing `/api/agent/*` calls made by the MCP server. |
| `MCP_AUTH_SECRET` | OAuth signature key shared between the web application and MCP processes. |
| `MCP_PUBLIC_URL` | Public endpoint domain representing the Claude Connector. |

---

## 3. Telegram Notifications & Alerts

The platform sends outbound notifications (fills, closures, admin approvals, daily summaries). Interactive trading sessions are held inside the Claude MCP interface.

---

## 4. User Registration & Approvals

*   When `AICHART_SINGLE_USER=0` (multi-user mode), newly registered users default to `pending` status. Access to the console and MCP endpoints remains blocked until approved by the administrator via `/console/platform?tab=users`.
*   Default authorization duration is **30 days** (renewable upon approval).

---

## 5. VPS Deployment & Commands

To deploy modifications onto a VPS:
```bash
# Execute deployment script
bash infra/vps-mcp-deploy.sh

# Restart PM2 processes
pm2 restart aichart-web aichart-mcp
```

*   OCO tracking is kept alive via server cron triggers. The agent wake loop (`AGENT_WAKE_ENABLED`) is disabled by default.
