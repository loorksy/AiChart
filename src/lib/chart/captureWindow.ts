/**
 * How many candles a chart image must show — live TradingView screenshot
 * and QuickChart fallback alike. Not a rejection gate: fewer bars still
 * render; this is the window we ask the renderer for.
 */
export const CHART_CAPTURE_CANDLES = 350;

/** A tab that polled within this window can answer a live-capture RPC. */
export const LIVE_TAB_FRESH_MS = 10_000;
