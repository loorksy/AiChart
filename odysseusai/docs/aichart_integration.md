# AiChart Trading Workspace Integration

Odysseus remains the primary app. AiChart supplies the TradingView workspace,
OANDA-backed market data, recommendation tooling, and MT5 execution through
AiChart Risk Guard.

## Files

- `services/aichart_bridge.py` signs/proxies allow-listed calls to AiChart with `AICHART_SERVICE_TOKEN` and the current user email.
- `routes/aichart_routes.py` exposes `/api/aichart/manifest`, `/api/aichart/chart-url`, and allow-listed `/api/aichart/proxy/...` endpoints.
- `static/js/aichart_chat_panel.js` exposes `window.OdysseusAiChart.openChart(...)`, `closeChart(...)`, and `updateChart(...)` for chat panels.
- `static/aichart_chat_panel.css` styles the embedded chart panel.
- `scripts/apply_aichart_integration.py` can patch `app.py` and `static/index.html` idempotently when direct edits are not already applied.

## Required app wiring

Register the router in `app.py` near the existing `setup_*_routes()` includes:

```python
from routes.aichart_routes import setup_aichart_routes
app.include_router(setup_aichart_routes())
```

Load the panel assets in `static/index.html` once:

```html
<link rel="stylesheet" href="/static/aichart_chat_panel.css">
<script type="module" src="/static/js/aichart_chat_panel.js"></script>
```

## Environment

```bash
AICHART_BASE_URL=http://127.0.0.1:3010
AICHART_SERVICE_TOKEN=change-me
```

The user identity rule is: Odysseus sends the current user's email to AiChart,
and AiChart must have an account with the same email.

## Chat usage

```js
window.OdysseusAiChart.openChart({
  symbol: "EURUSD",
  interval: "15m",
  source: "oanda",
  sessionId: currentSessionId,
});
```

Agent/tool SSE events should use:

```json
{
  "type": "aichart_workspace",
  "data": { "symbol": "EURUSD", "interval": "15m", "source": "oanda" }
}
```

## Safety

Odysseus does not execute trades locally. All execution requests must be proxied
to AiChart and pass AiChart Risk Guard / MT5 bridge checks.
