/**
 * TradingView Advanced Charting Library mount for the Odysseus trading
 * workspace. Loads the licensed library from /charting_library/, builds a
 * widget backed by the Odysseus OANDA datafeed, and draws the agent's
 * entry/SL/TP as read-only levels (agent drawings stay separate from the
 * user's own drawing tools).
 *
 * If the licensed assets are not installed at /charting_library/, loadTvScript
 * rejects and the caller falls back to the lightweight canvas renderer — the
 * workspace keeps working without the vendor bundle.
 */

import { createOandaDatafeed } from "./tv_datafeed.js";

const LIBRARY_PATH = "/charting_library/";
const SCRIPT_SRC = "/charting_library/charting_library.standalone.js";

const RES = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "1d": "1D", "1w": "1W" };
export function toResolution(interval) { return RES[interval] || "15"; }

let scriptPromise = null;
export function loadTvScript() {
  if (window.TradingView?.widget) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => (window.TradingView?.widget ? resolve() : reject(new Error("tv-missing"))));
      existing.addEventListener("error", () => reject(new Error("tv-load-failed")));
      if (window.TradingView?.widget) resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.TradingView?.widget ? resolve() : reject(new Error("tv-missing")));
    s.onerror = () => { scriptPromise = null; reject(new Error("tv-load-failed")); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function cssVar(name, fallback) {
  return (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
}

/**
 * Mount a TradingView widget into `container`.
 * @returns {Promise<object>} the widget instance (throws if the library is absent).
 */
export async function mountTvWidget(container, { symbol, interval, levels } = {}) {
  await loadTvScript();
  if (!window.TradingView?.widget) throw new Error("tv-missing");

  const theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const bg = cssVar("--bg", "#0f1115");

  const widget = new window.TradingView.widget({
    container,
    library_path: LIBRARY_PATH,
    datafeed: createOandaDatafeed(),
    symbol: String(symbol || "EURUSD").toUpperCase(),
    interval: toResolution(interval || "15m"),
    locale: "ar",
    theme,
    autosize: true,
    timezone: "Etc/UTC",
    disabled_features: ["use_localstorage_for_settings", "header_saveload", "popup_hints"],
    enabled_features: ["hide_left_toolbar_by_default"],
    overrides: { "paneProperties.background": bg, "paneProperties.backgroundType": "solid" },
    loading_screen: { backgroundColor: bg },
  });

  if (levels) {
    widget.onChartReady(() => { try { drawAgentLevels(widget, levels); } catch (e) { /* non-fatal */ } });
  }
  return widget;
}

/** Draw the agent's entry/SL/TP as read-only horizontal lines (agent layer). */
export function drawAgentLevels(widget, levels) {
  const chart = widget.activeChart ? widget.activeChart() : widget.chart();
  const green = cssVar("--tw-green", "#26a269"), red = cssVar("--tw-red", "#e01b24"), accent = cssVar("--tw-accent", "#00aaff");
  const spec = [
    ["entry", levels.entry, accent, "دخول"],
    ["stop_loss", levels.stop_loss, red, "وقف"],
    ["take_profit", levels.take_profit, green, "هدف"],
  ];
  for (const [, price, color, text] of spec) {
    if (price == null) continue;
    try {
      chart.createShape(
        { time: chart.getVisibleRange ? chart.getVisibleRange().to : Date.now() / 1000, price: Number(price) },
        {
          shape: "horizontal_line",
          text,
          disableSelection: true,      // agent drawings are read-only for the user
          disableSave: true,
          disableUndo: true,
          lock: true,
          overrides: { linecolor: color, linewidth: 1, linestyle: 2, showLabel: true, textcolor: color },
        },
      );
    } catch (e) { /* older library builds — ignore */ }
  }
}

/** True if the licensed library is loadable (probes without throwing). */
export async function isTvAvailable() {
  try { await loadTvScript(); return Boolean(window.TradingView?.widget); }
  catch { return false; }
}
