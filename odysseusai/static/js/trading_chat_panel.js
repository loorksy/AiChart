/**
 * Trading workspace panel for the MAIN Odysseus chat.
 *
 * When an agent tool returns a `trading_workspace` payload, the agent loop
 * streams it and chatRenderer calls window.OdysseusTrading.openChart(...) to
 * mount a chart INSIDE the assistant bubble — the "agent opens the chart in the
 * conversation" flow. Charts render with the licensed TradingView Advanced
 * Charting Library (native OANDA datafeed); when the bundle is absent we show a
 * link to the full /trading workspace.
 */

import { mountTvWidget, isTvAvailable } from "./tv_chart.js";

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function findMount(preferred) {
  if (preferred && preferred.appendChild) return preferred;
  const marked = document.querySelector("[data-trading-mount]");
  if (marked) return marked;
  const history = document.getElementById("chat-history");
  if (!history) return null;
  const msgs = history.querySelectorAll(".msg-ai");
  const last = msgs[msgs.length - 1];
  if (last) {
    const body = last.querySelector(".body");
    if (body) return body;
  }
  return history;
}

async function openChart(data = {}, mountTarget) {
  const mount = findMount(mountTarget);
  if (!mount) { console.warn("OdysseusTrading: no chat mount target"); return null; }

  const symbol = String(data.symbol || "EURUSD").toUpperCase();
  const interval = data.interval || "15m";
  const levels = data.levels || null;

  const card = document.createElement("div");
  card.className = "tw-chat-chart";
  card.innerHTML =
    `<div class="tw-chat-chart-head"><b>${esc(symbol)}</b> <span>${esc(interval)}</span> · OANDA` +
    `<a class="tw-chat-open" href="/trading?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}" target="_blank" title="فتح مساحة التداول">↗</a>` +
    `<button class="tw-chat-close" title="إغلاق">✕</button></div>` +
    `<div class="tw-chat-chart-mount"></div>`;
  card.querySelector(".tw-chat-close").onclick = () => card.remove();
  mount.appendChild(card);

  const mountEl = card.querySelector(".tw-chat-chart-mount");
  try {
    if (await isTvAvailable()) {
      mountEl.style.height = "320px";
      await mountTvWidget(mountEl, { symbol, interval, levels });
    } else {
      mountEl.innerHTML =
        `<div class="tw-chat-fallback">افتح مساحة التداول لعرض الشارت التفاعلي الكامل ` +
        `(<a href="/trading?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}" target="_blank">/trading</a>).</div>`;
    }
  } catch (e) {
    mountEl.innerHTML = `<div class="tw-chat-fallback">تعذّر عرض الشارت: ${esc(e.message)}</div>`;
  }
  return card;
}

window.OdysseusTrading = { openChart };

export { openChart };
