/**
 * TradingView Advanced Charting Library datafeed for Odysseus.
 *
 * Implements the IBasicDataFeed contract against the native trading engine
 * (/api/trading/market/candles + /api/trading/instruments), so the licensed
 * TradingView widget renders OANDA candles served by Odysseus itself. No
 * third-party data host is contacted from the browser.
 *
 * Note: historical back-pagination (scrolling years back) needs from/to
 * support on the candles endpoint; until then getBars serves the most recent
 * window and reports noData for older ranges (prevents infinite paging).
 */

const API = "/api/trading";

const RES_TO_INTERVAL = {
  "1": "1m", "3": "3m", "5": "5m", "15": "15m", "30": "30m",
  "60": "1h", "120": "2h", "240": "4h", "1D": "1d", D: "1d", "1W": "1w", W: "1w",
};
const SUPPORTED_RESOLUTIONS = ["1", "5", "15", "30", "60", "240", "1D", "1W"];

function resToInterval(res) { return RES_TO_INTERVAL[res] || "15m"; }

function priceScale(symbol) {
  const s = String(symbol).toUpperCase();
  if (s.includes("JPY")) return 1000;          // 3 decimals
  if (s.includes("XAU") || s.includes("XAG")) return 100; // metals, 2 decimals
  return 100000;                                // forex majors, 5 decimals
}

function pollMs(res) {
  const iv = resToInterval(res);
  if (iv === "1m") return 5000;
  if (iv === "5m") return 10000;
  if (iv === "15m" || iv === "30m") return 20000;
  return 30000;
}

async function fetchCandles(symbol, interval, count = 500) {
  const q = new URLSearchParams({ symbol, interval, count: String(count) });
  const res = await fetch(`${API}/market/candles?${q}`, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`candles ${res.status}`);
  const data = await res.json();
  return { candles: data.candles || [], configured: data.configured !== false };
}

export function createOandaDatafeed() {
  const subs = new Map();

  return {
    onReady(cb) {
      setTimeout(() => cb({
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        exchanges: [{ value: "OANDA", name: "OANDA", desc: "OANDA (Odysseus)" }],
        symbols_types: [{ name: "forex", value: "forex" }],
        supports_marks: false,
        supports_timescale_marks: false,
      }), 0);
    },

    async searchSymbols(userInput, exchange, symbolType, onResult) {
      try {
        const res = await fetch(`${API}/instruments`, { credentials: "same-origin" });
        const data = await res.json();
        const q = String(userInput || "").toUpperCase();
        const items = (data.instruments || [])
          .filter((i) => !q || i.symbol.includes(q))
          .slice(0, 30)
          .map((i) => ({
            symbol: i.symbol, full_name: i.symbol, description: i.displayName || i.symbol,
            exchange: "OANDA", ticker: i.symbol, type: "forex",
          }));
        onResult(items);
      } catch { onResult([]); }
    },

    resolveSymbol(symbolName, onResolve, onError) {
      const symbol = String(symbolName).toUpperCase().replace(/[^A-Z0-9]/g, "");
      setTimeout(() => {
        onResolve({
          name: symbol, ticker: symbol, description: symbol,
          type: "forex", session: "24x7", exchange: "OANDA", listed_exchange: "OANDA",
          timezone: "Etc/UTC", format: "price",
          pricescale: priceScale(symbol), minmov: 1,
          has_intraday: true, has_daily: true, has_weekly_and_monthly: true,
          supported_resolutions: SUPPORTED_RESOLUTIONS, volume_precision: 0,
          data_status: "streaming",
        });
      }, 0);
    },

    async getBars(symbolInfo, resolution, periodParams, onResult, onError) {
      const { from, to, firstDataRequest, countBack } = periodParams;
      const interval = resToInterval(resolution);
      try {
        // Backend serves the latest N candles only. On the first request, fetch
        // a generous window; on paging requests for older data, report noData.
        if (!firstDataRequest) { onResult([], { noData: true }); return; }
        const count = Math.min(Math.max(countBack || 300, 300) + 50, 5000);
        const { candles, configured } = await fetchCandles(symbolInfo.name, interval, count);
        if (!configured) { onError("OANDA غير مُهيّأ — أضف مفتاح OANDA من الإعدادات."); return; }
        const fromMs = from * 1000, toMs = to * 1000;
        const bars = candles
          .filter((c) => c.time >= fromMs && c.time <= toMs)
          .map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 }));
        onResult(bars.length ? bars : candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 })), { noData: bars.length === 0 && candles.length === 0 });
      } catch (e) {
        onError(e.message || "getBars failed");
      }
    },

    subscribeBars(symbolInfo, resolution, onTick, listenerGuid) {
      const interval = resToInterval(resolution);
      const tick = async () => {
        try {
          const { candles } = await fetchCandles(symbolInfo.name, interval, 2);
          const last = candles[candles.length - 1];
          if (last) onTick({ time: last.time, open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume || 0 });
        } catch { /* transient — keep polling */ }
      };
      const id = setInterval(tick, pollMs(resolution));
      subs.set(listenerGuid, id);
      tick();
    },

    unsubscribeBars(listenerGuid) {
      const id = subs.get(listenerGuid);
      if (id) { clearInterval(id); subs.delete(listenerGuid); }
    },
  };
}
