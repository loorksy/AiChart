# TradingView Advanced Charting Library (vendor assets)

This directory serves the **licensed** TradingView Advanced Charting Library at
`/charting_library/`. The library is proprietary and is **not** committed to
this repository — you must supply your own licensed build.

## Install

1. Obtain the Advanced Charting Library from TradingView (requires a license
   granted at https://www.tradingview.com/advanced-charts/).
2. Copy the contents of the library's `charting_library/` folder into this
   directory so the loader can reach:

   ```
   odysseusai/charting_library/charting_library.standalone.js
   odysseusai/charting_library/bundles/…
   odysseusai/charting_library/…
   ```

3. Restart Odysseus. The trading workspace (`/trading`) will detect the bundle
   and mount the real TradingView widget.

If the bundle is absent, the workspace automatically falls back to the built-in
lightweight canvas candlestick renderer — everything else keeps working.

## Data

Candles come from Odysseus's own OANDA-backed endpoint
(`/api/trading/market/candles`) via `static/js/tv_datafeed.js`. No third-party
data host is contacted from the browser.
