# MetaTrader EA Diagnostics & Troubleshooting Guide

Read this document before diagnosing any Forex or Expert Advisor (EA) execution failures.

---

## 1. Pre-Diagnostic Checklist
Run these endpoints to gather facts before reporting any issue to the operator:
```bash
GET /api/agent/live/account           # Unified live data for MT5/Binance + quoteAgeMs
GET /api/agent/risk/status          # Checks activeMarket (crypto | forex)
GET /api/agent/portfolio            # Checks if forex.ea.online is true and account_login
GET /api/agent/ea/diagnostics?symbol=EURUSD   # Lists symbols received in heartbeat
GET /api/agent/ea/live-quotes?symbol=EURUSD   # Fetches live prices streamed by EA v3
```

---

## 2. Forbidden Statements (Do Not Tell the Operator)
*   **Do not say**: "Bridge API is incomplete" — The bridge functions correctly as long as the EA status is **online**.
*   **Do not say**: "Check port 3010" — The EA connects directly to `https://aichart.lork.cloud` (or the configured web server domain) over port 443.
*   **Do not say**: "No candidates in scan means EA cannot see Forex" — The market scanner is a **technical indicator check** on `allowed_assets`; it is independent of the EA connection status.
*   **Do not say**: "EA does not support symbol format" — If a `retcode` is returned, the symbol was found; the rejection came from the **broker/MT5 server**.

---

## 3. MT5 Retcode Table

| retcode | Constant / Meaning | Direct Action & Message to Operator |
|---------|--------------------|------------------------------------|
| **10016** | `TRADE_RETCODE_INVALID_STOPS` — Invalidation | Stop Loss or Take Profit levels are invalid. Try opening the trade manually **without SL/TP**. |
| **10026** | `TRADE_RETCODE_OFF_QUOTES` — Stale price | **Do not assume the market is closed**. Check Market Watch and `quoteAgeMs`. If quotes are active, verify if Instant Execution / filling mode is supported (EA v3.01+). |
| **10019** | `TRADE_RETCODE_NO_MONEY` — Insufficient funds | Leverage or balance limit reached. Specify the margin requirements in the reply. |
| **10014** | `TRADE_RETCODE_INVALID_VOLUME` | Lot size is invalid. Adjust contract size. |
| **10015** | `TRADE_RETCODE_INVALID_PRICE` | The price passed in the request is invalid. |

*   If the response contains `symbol not found` (not a retcode), it means the symbol name does not match the MT5 terminal **literally** (names are case-sensitive).

---

## 4. Exness / Suffix Case (`EURUSDm`)
Certain brokers (e.g., Exness, Pepperstone) append case-sensitive suffixes to currency symbols:
*   **Valid**: `EURUSDm`, `GBPUSDm`, `XAUUSDm`
*   **Invalid**: `EURUSDM`, `GBPUSDM` (MT5 will reject `SymbolSelect`)

*   **Bridge Layer (Web)**: `resolveMt5Symbol` automatically resolves symbol names to match the active heartbeat. A request for `EURUSD` will match `EURUSDm` dynamically.
*   **Diagnostic Tools**:
    ```bash
    GET /api/agent/ea/diagnostics?symbol=EURUSDm   # Verifies hasSymbol, quotesOk
    GET /api/agent/ea/query-terminal               # Checks if ea_version >= 3.05
    ```
*   **EA v3.06+**: Implements `ResolveBrokerSymbol()`. If the bridge requests `EURUSDM`, it is automatically matched to `EURUSDm` using the Market Watch list.

---

## 5. Modifying Chart Periods / Symbols (AutoTrading Disable)
In MetaTrader 5, manually changing the timeframe (e.g., H1 to M15) or switching the chart symbol automatically disables the **AutoTrading** switch:
*   **Warning message**: `Automated Trading disabled because chart symbol or period has been changed`
*   **EA v3.09+ behavior**: The EA stays online; heartbeat signals and drawing captures (`draw_and_capture`) continue to work.
*   **Trade Execution**: Trading operations require manually re-enabling the AutoTrading button in the MT5 terminal.
*   **Experts Tab**: Check for `AiChartBridge: chart symbol/period changed — re-enable AutoTrading if disabled.`

---

## 6. AutoTrading Disabled by Server (retcode 10026)
Some demo/live accounts block automated trading server-side, even if the local AutoTrading button is green.
*   **Experts tab**: `AutoTrading disabled by server`
*   **Solution**: Switch brokers, try a different account, or request algorithmic trading activation from Exness/broker support (this is not an AiChart bug).

---

## 7. Asset Routing: Crypto vs Forex

| Symbol | activeMarket=crypto | activeMarket=forex |
|--------|---------------------|---------------------|
| `TRXUSDT`, `BTCUSDT` | Routed to **Binance** | Do not route to MT5 unless `BTCUSD` is explicitly active in diagnostics |
| `EURUSD`, `GBPUSD` | Ignored | Routed to **MT5 EA** (verified via `diagnostics.symbols`) |

*   If the system returns "Symbol specifications not available from MetaTrader", the symbol is missing from the last heartbeat or the EA is offline. Do not poll indefinitely; run diagnostics.

---

## 8. Handling Forex Trade Failures

1.  Extract the `reason` from the API response and output it **literally**.
2.  Ask the operator: "Have you opened a manual trade on this symbol in MT5?"
3.  If `retcode 10016` occurred, but manual trades with the same stops succeeded, check the stop level formulas.
4.  If manual trades fail as well, the issue lies with the broker/account parameters.

---

## 9. 10026 with Active Quotes (Instant Execution)
This occurs when:
*   The broker uses **Instant Execution** (not Market Execution).
*   The EA passes `price=0` or an unsupported filling mode.

*   **Diagnostic Tools**:
    ```bash
    GET /api/agent/ea/diagnostics?symbol=EURUSD   # Checks trade_execution, filling_mode
    POST query_mt5_terminal                       # Verifies reference_symbol
    ```
*   **Resolution**: Ensure EA version is **v3.01+**, recompile `ea/mt5/AiChartBridge.mq5`, and attach it to the chart.

---

## 10. Example of Correct Diagnostic Response
> EA is online (Exness account 116921). Execution failed: retcode **10016** = Invalid stop loss / take profit levels.
> Action: Open a EURUSD position manually in MT5 **without SL/TP**. If successful, we will adjust the recommendation parameters. If it fails, contact Exness support.
