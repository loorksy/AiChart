# Lonora

An AI analyst for one instrument: **gold (XAUUSD)**.

It reads the live market, reasons over it through an ordered chain of
analysis gates, and issues a complete trading recommendation — direction,
entry, stop, targets, rationale, and a calibrated confidence drawn from
backtested evidence.

**It never places, modifies, or closes a trade.** There is no broker
integration, no account linking, and no execution path of any kind. Every
recommendation is tracked to a terminal outcome against the market's own
candles, and those outcomes feed the performance record and the strategy
calibration that the next recommendation is measured against.

## Surfaces

- **Chat** — talk to the analyst; charts and cards render inline.
- **Recommendations** — every plan, its evidence, and its outcome.
- **Performance** — equity curve in R, win rate, expectancy, decay alerts.

Also reachable from Telegram, with the same brain behind both.

## Stack

Next.js (app + API routes) · `mcp/` MCP server (read-and-recommend tools) ·
`research-service/` Python backtester · OANDA for all market data.

## Running it

```bash
npm install
cp .env.example .env    # OANDA_API_TOKEN, OANDA_ACCOUNT_ID, OANDA_ENV
npm run dev
```

```bash
npm run test:ci         # full suite
```
