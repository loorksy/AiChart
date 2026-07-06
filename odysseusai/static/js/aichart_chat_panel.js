/**
 * AiChart trading workspace panel — embedded chart + semi-auto execute card.
 */

const _panels = new Map();

function _esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _panelKey(data) {
  return String(data.sessionId || data.symbol || "default");
}

async function _fetchChartUrl(params) {
  const q = new URLSearchParams();
  if (params.symbol) q.set("symbol", params.symbol);
  if (params.interval) q.set("interval", params.interval);
  if (params.source) q.set("source", params.source);
  if (params.sessionId) q.set("session_id", params.sessionId);
  if (params.layoutId) q.set("layout_id", params.layoutId);
  if (params.recommendationId != null) {
    q.set("recommendation_id", String(params.recommendationId));
  }
  if (params.readonlyAgentDrawings) {
    q.set("readonly_agent_drawings", "1");
  }
  if (params.tradingMode) {
    q.set("trading_mode", params.tradingMode);
  }
  const res = await fetch(`/api/aichart/chart-url?${q.toString()}`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.detail || `chart-url ${res.status}`);
  }
  return res.json();
}

function _findMountTarget(preferred) {
  if (preferred && preferred.appendChild) return preferred;
  const marked = document.querySelector("[data-aichart-chat-mount]");
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

function _renderWorkspace(mountEl, data, embedUrl) {
  const key = _panelKey(data);
  const existing = mountEl.querySelector(`.aichart-workspace[data-key="${key}"]`);
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.className = "aichart-workspace";
  wrap.dataset.key = key;
  wrap.dataset.symbol = data.symbol || "EURUSD";
  wrap.dataset.interval = data.interval || "15m";

  const header = document.createElement("div");
  header.className = "aichart-workspace-header";
  const modeLabel = data.tradingMode ? `<span class="aichart-mode-badge">${_esc(data.tradingMode)}</span>` : "";
  header.innerHTML =
    `<div class="aichart-workspace-meta">` +
    `<span>${_esc(data.symbol || "EURUSD")}</span>` +
    `<span>${_esc(data.interval || "15m")}</span>` +
    `<span>${_esc(data.source || "oanda")}</span>` +
    modeLabel +
    `</div>` +
    `<button type="button" class="aichart-workspace-close" title="Close chart">✕</button>`;

  const frameWrap = document.createElement("div");
  frameWrap.className = "aichart-workspace-frame-wrap";

  const loading = document.createElement("div");
  loading.className = "aichart-workspace-loading";
  loading.textContent = "Loading chart…";
  frameWrap.appendChild(loading);

  const iframe = document.createElement("iframe");
  iframe.title = `Chart ${data.symbol || "EURUSD"}`;
  iframe.loading = "lazy";
  iframe.referrerPolicy = "no-referrer";
  iframe.allow = "fullscreen";
  iframe.src = embedUrl;
  iframe.addEventListener("load", () => {
    loading.remove();
  });
  iframe.addEventListener("error", () => {
    loading.className = "aichart-workspace-error";
    loading.textContent = "Failed to load chart iframe.";
  });
  frameWrap.appendChild(iframe);

  header.querySelector(".aichart-workspace-close")?.addEventListener("click", () => {
    wrap.remove();
    _panels.delete(key);
  });

  wrap.appendChild(header);
  wrap.appendChild(frameWrap);
  mountEl.appendChild(wrap);
  _panels.set(key, { wrap, data, embedUrl });
  return wrap;
}

function renderTradeProposal(mountEl, proposal) {
  if (!mountEl || !proposal) return null;
  const card = document.createElement("div");
  card.className = "aichart-trade-proposal";
  card.innerHTML =
    `<h4>Trade proposal — ${_esc(proposal.symbol || "EURUSD")}</h4>` +
    `<div class="aichart-trade-grid">` +
    `<label>Entry<input type="number" step="any" data-field="entry" value="${_esc(proposal.entry ?? "")}"></label>` +
    `<label>Size (lots)<input type="number" step="any" data-field="notional" value="${_esc(proposal.notional ?? proposal.size ?? "")}"></label>` +
    `<label>Stop loss<input type="number" step="any" data-field="stop_loss" value="${_esc(proposal.stop_loss ?? proposal.stopLoss ?? "")}"></label>` +
    `<label>Take profit<input type="number" step="any" data-field="take_profit" value="${_esc(proposal.take_profit ?? proposal.takeProfit ?? "")}"></label>` +
    `</div>` +
    `<div class="aichart-trade-actions">` +
    `<button type="button" class="primary" data-action="execute">Execute</button>` +
    `<button type="button" data-action="dismiss">Dismiss</button>` +
    `</div>`;

  const readFields = () => {
    const out = { ...proposal };
    card.querySelectorAll("[data-field]").forEach((el) => {
      const field = el.getAttribute("data-field");
      const val = el.value;
      if (field && val !== "") out[field] = Number(val);
    });
    return out;
  };

  card.querySelector('[data-action="dismiss"]')?.addEventListener("click", () => {
    card.remove();
  });

  card.querySelector('[data-action="execute"]')?.addEventListener("click", async () => {
    const btn = card.querySelector('[data-action="execute"]');
    if (btn) btn.disabled = true;
    const payload = readFields();
    try {
      const res = await fetch("/api/aichart/proxy/agent/trade/open", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: payload.symbol,
          side: payload.side || "buy",
          notional: payload.notional,
          stop_loss: payload.stop_loss,
          take_profit: payload.take_profit,
          entry: payload.entry,
          approved_by_user: true,
          market: "forex",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || body.message || `Execute failed (${res.status})`);
      }
      card.innerHTML =
        `<p>Executed ${_esc(payload.symbol)} — check MT5 / open trades.</p>`;
    } catch (err) {
      if (btn) btn.disabled = false;
      alert(err.message || String(err));
    }
  });

  mountEl.appendChild(card);
  return card;
}

async function openChart(data = {}, mountTarget) {
  const params = {
    symbol: (data.symbol || "EURUSD").toUpperCase(),
    interval: data.interval || "15m",
    source: data.source || "oanda",
    sessionId: data.sessionId || data.session_id || null,
    layoutId: data.layoutId || data.layout_id || null,
    recommendationId: data.recommendationId || data.recommendation_id || null,
    readonlyAgentDrawings: data.readonlyAgentDrawings || data.readonly_agent_drawings || null,
    tradingMode: data.tradingMode || data.trading_mode || null,
  };
  const mountEl = _findMountTarget(mountTarget);
  if (!mountEl) {
    console.warn("OdysseusAiChart: no chat mount target");
    return null;
  }
  try {
    const info = await _fetchChartUrl(params);
    const wrap = _renderWorkspace(mountEl, params, info.embedUrl);
    if (data.tradeProposal) {
      renderTradeProposal(mountEl, data.tradeProposal);
    }
    return wrap;
  } catch (err) {
    console.error("OdysseusAiChart.openChart", err);
    const errEl = document.createElement("div");
    errEl.className = "aichart-workspace-error";
    errEl.textContent = err.message || "Could not open chart.";
    mountEl.appendChild(errEl);
    return null;
  }
}

function closeChart(sessionId) {
  const key = String(sessionId || "default");
  const entry = _panels.get(key);
  if (entry?.wrap) entry.wrap.remove();
  _panels.delete(key);
}

function updateChart(sessionId, patch = {}) {
  return openChart({ ...patch, sessionId });
}

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || msg.source !== "aichart-odysseus-embed") return;
  const key = _panelKey({ sessionId: msg.sessionId });
  const entry = _panels.get(key);
  if (!entry) return;
  if (msg.type === "symbolChanged" && entry.wrap) {
    entry.wrap.dataset.symbol = msg.symbol || entry.wrap.dataset.symbol;
  }
  if (msg.type === "intervalChanged" && entry.wrap) {
    entry.wrap.dataset.interval = msg.interval || entry.wrap.dataset.interval;
  }
});

window.OdysseusAiChart = {
  openChart,
  closeChart,
  updateChart,
  renderTradeProposal,
};

export { openChart, closeChart, updateChart, renderTradeProposal };
