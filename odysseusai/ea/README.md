# Odysseus MT5 Bridge (Expert Advisor)

`mt5/OdysseusBridge.mq5` connects a MetaTrader 5 terminal to Odysseus so the
platform can execute trades on the user's own broker account. OANDA provides
market **data**; execution happens **only** through this EA.

## Install

1. In the Odysseus trading workspace (`/trading`) → broker panel →
   **ربط MetaTrader 5** — mint your one-time EA token.
2. Copy `mt5/OdysseusBridge.mq5` into MetaTrader 5
   `MQL5/Experts/` and compile it (F7 in MetaEditor).
3. Attach the EA to any chart. In its inputs set:
   - `ApiBase` = your Odysseus base URL (e.g. `https://your-odysseus-host`)
   - `EaToken` = the token you minted
4. Allow WebRequest to your Odysseus host
   (Tools → Options → Expert Advisors → Allow WebRequest for listed URL).
5. Enable AutoTrading.

## Protocol

The EA speaks the native bridge under `/api/ea-bridge`:

| Path | Purpose |
|------|---------|
| `POST /api/ea-bridge/heartbeat` | account + positions + symbol specs; returns flags + commands |
| `GET  /api/ea-bridge/commands` | poll queued trade commands |
| `POST /api/ea-bridge/commands/{id}/ack` | report fill result (ticket/price/lots/error) |
| `POST /api/ea-bridge/quotes` | best-effort intraday tick flush |
| `POST /api/ea-bridge/event` | trade-event notification |

Execution safety: the server only queues commands that already passed the
Risk Guard. The EA refuses orders without a stop loss unless `AllowNoSL` is
explicitly enabled.

> Note: this EA was mechanically ported from the previous bridge; recompile and
> smoke-test on a **demo** account before any live use.
