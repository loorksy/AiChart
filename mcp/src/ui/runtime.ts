/**
 * Unified widget runtime injected into every card. Detects the host:
 * - ChatGPT Apps SDK: `window.openai` bridge (toolOutput / callTool / events).
 * - MCP Apps (Claude & co.): postMessage JSON-RPC per spec 2026-01-26
 *   (ui/initialize handshake, ui/notifications/tool-result, tools/call).
 * Exposes one API: AIC.getData / onData / callTool / openLink / bindConfirm.
 * bindConfirm implements the two-step "execute with confirmation" pattern.
 */
export const RUNTIME_JS = `
(function () {
  var listeners = [];
  var latest = null;
  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](latest); } catch (e) {}
    }
  }

  function finishApi(api) {
    api.onData = function (cb) {
      listeners.push(cb);
      if (latest != null) { try { cb(latest); } catch (e) {} }
    };
    api.getData = function () { return latest; };
    api.bindConfirm = function (btn, onConfirmed) {
      var armed = false, orig = btn.textContent, timer = null;
      btn.addEventListener("click", function () {
        if (!armed) {
          armed = true;
          btn.classList.add("confirming");
          btn.textContent = "تأكيد؟ اضغط مرة أخرى";
          timer = setTimeout(function () {
            armed = false;
            btn.classList.remove("confirming");
            btn.textContent = orig;
          }, 4000);
          return;
        }
        clearTimeout(timer);
        armed = false;
        btn.classList.remove("confirming");
        btn.textContent = orig;
        onConfirmed();
      });
    };
    api.fmt = function (n, d) {
      if (n == null || isNaN(n)) return "—";
      return Number(n).toLocaleString(undefined, { maximumFractionDigits: d == null ? 5 : d });
    };
    /* Strict numeric extraction: finite number out, or null. Objects yield
       their first finite price-like field — never NaN, never 0-for-missing. */
    api.num = function (v) {
      if (typeof v === "number") return isFinite(v) ? v : null;
      if (typeof v === "string" && v.trim() !== "") {
        var p = Number(v);
        return isFinite(p) ? p : null;
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        var keys = ["price", "value", "level", "close", "mid", "bid"];
        for (var i = 0; i < keys.length; i++) {
          var inner = v[keys[i]];
          if (typeof inner === "number" && isFinite(inner)) return inner;
        }
      }
      return null;
    };
    /* Safe display cell: string for the UI or null (= hide the row).
       Never "[object Object]", never a fabricated number. */
    api.cell = function (v, d) {
      if (v == null || v === "") return null;
      if (typeof v === "number") return isFinite(v) ? api.fmt(v, d) : null;
      if (typeof v === "boolean") return v ? "نعم" : "لا";
      if (typeof v === "string") return v;
      var n = api.num(v);
      return n == null ? null : api.fmt(n, d);
    };
    api.formatOpenTrades = function (v) {
      if (v == null) return "—";
      if (typeof v === "number") return String(v);
      if (typeof v === "string") return v;
      if (!Array.isArray(v)) return String(v);
      if (!v.length) return "0";
      return v.map(function (t) {
        if (!t || typeof t !== "object") return String(t);
        var sym = t.symbol || t.sym || "?";
        var side = String(t.side || "").toLowerCase();
        var sideAr = side === "buy" ? "شراء" : side === "sell" ? "بيع" : side || "—";
        var pnl = t.pnl != null ? t.pnl : (t.open_pnl != null ? t.open_pnl : t.profit);
        var pnlStr = (pnl != null && !isNaN(pnl)) ? " · PnL " + Number(pnl).toFixed(2) : "";
        return sym + " " + sideAr + pnlStr;
      }).join(" | ");
    };
    api.pickTrades = function (data) {
      data = data || {};
      if (Array.isArray(data.trades)) return data.trades;
      if (Array.isArray(data.openTrades)) return data.openTrades;
      if (Array.isArray(data.open_trades)) return data.open_trades;
      if (Array.isArray(data.aichartTrades) && data.aichartTrades.length) return data.aichartTrades;
      var bp = data.brokerPositions || {};
      if (Array.isArray(bp.mt5) && bp.mt5.length) return bp.mt5;
      var p = data.portfolio || {};
      if (Array.isArray(p.openTrades)) return p.openTrades;
      if (Array.isArray(p.open_trades)) return p.open_trades;
      if (Array.isArray(p.trades)) return p.trades;
      return [];
    };
    api.bridgeLinkState = function (data) {
      data = data || {};
      var live = data.live || {};
      var forex = live.forex || data.forex || {};
      var ea = forex.ea || live.ea || data.ea || {};
      var envForex = (data.executionEnv && data.executionEnv.forex) || {};
      var quoteAge = ea.quoteAgeMs != null ? ea.quoteAgeMs : data.quoteAgeMs;
      if (data.bridgeOffline === true || data.offline === true) {
        return { stale: true, label: "الجسر غير متصل — لا بيانات حية" };
      }
      var offline = ea.heartbeatFresh === false || ea.online === false || ea.connected === false ||
        forex.heartbeatFresh === false || envForex.online === false;
      if (offline) return { stale: true, label: "EA غير متصل / بيانات قديمة" };
      if (quoteAge != null && quoteAge > 5000) {
        return { stale: true, label: "أسعار قديمة (" + Math.round(quoteAge / 1000) + "s)" };
      }
      var evidence = ea.heartbeatFresh === true || ea.online === true || ea.connected === true ||
        forex.heartbeatFresh === true || envForex.online === true || quoteAge != null;
      /* No connectivity signal in the payload → say nothing, don't claim online. */
      return evidence ? { stale: false, label: "متصل" } : { stale: false, label: "" };
    };
    api.applyBridgeBadge = function (el, data) {
      if (!el) return;
      var s = api.bridgeLinkState(data);
      el.textContent = s.label;
      el.className = "status " + (s.stale ? "stale" : "live");
    };
    api.renderTradeLines = function (container, trades, fmt) {
      if (!container) return;
      container.innerHTML = "";
      if (!trades.length) {
        container.innerHTML = '<div class="empty">لا صفقات مفتوحة</div>';
        return;
      }
      trades.forEach(function (t) {
        if (!t || typeof t !== "object") return;
        var sym = t.symbol || t.sym || "?";
        var side = String(t.side || "").toLowerCase();
        var sideAr = side === "buy" ? "شراء" : side === "sell" ? "بيع" : side || "—";
        var pnl = t.pnl != null ? t.pnl : (t.open_pnl != null ? t.open_pnl : t.profit);
        var line = document.createElement("div");
        line.className = "trade-line";
        line.textContent = sym + " · " + sideAr +
          (pnl != null && !isNaN(pnl) ? " · PnL " + fmt(pnl, 2) : "");
        container.appendChild(line);
      });
    };
    window.AIC = api;
    if (window.__aicReady) { try { window.__aicReady(api); } catch (e) {} }
  }

  function normalizeToolResult(r) {
    return (r && r.structuredContent) || r;
  }

  if (window.openai) {
    /* ── ChatGPT (Apps SDK / skybridge) ── */
    function readOpenAiData() {
      var meta = window.openai.toolResponseMetadata || null;
      return window.openai.toolOutput || (meta && (meta.structuredContent || meta.toolOutput || meta.data)) || meta || null;
    }
    latest = readOpenAiData();
    window.addEventListener("openai:set_globals", function () {
      latest = readOpenAiData() || latest;
      emit();
    });
    finishApi({
      host: "chatgpt",
      callTool: function (name, args) {
        return window.openai.callTool(name, args || {}).then(function (r) {
          return normalizeToolResult(r);
        });
      },
      sendFollowUpMessage: function (text) {
        if (window.openai.sendFollowUpMessage) {
          return window.openai.sendFollowUpMessage(text);
        }
        return Promise.resolve();
      },
      openLink: function (url) {
        try { window.openai.openExternal({ href: url }); }
        catch (e) { window.open(url, "_blank"); }
      },
      notifySize: function () {},
    });
    if (latest != null) setTimeout(emit, 0);
  } else {
    /* ── MCP Apps (postMessage JSON-RPC) ── */
    var reqId = 1;
    var pending = {};
    function send(msg) { window.parent.postMessage(msg, "*"); }
    function request(method, params) {
      return new Promise(function (resolve, reject) {
        var id = reqId++;
        pending[id] = { resolve: resolve, reject: reject };
        send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
      });
    }
    window.addEventListener("message", function (ev) {
      var m = ev.data;
      if (!m) return;
      if (m.method === "render-data" || m.method === "ui/lifecycle/render-data" || m.type === "render-data") {
        var rd = m.params || m.payload || m.data || {};
        latest = rd.structuredContent || rd.toolOutput || rd.data || rd;
        emit();
        setTimeout(notifySize, 50);
        return;
      }
      if (m.jsonrpc !== "2.0") return;
      if (m.id != null && pending[m.id]) {
        var p = pending[m.id];
        delete pending[m.id];
        if (m.error) p.reject(new Error((m.error && m.error.message) || "host error"));
        else p.resolve(m.result);
        return;
      }
      if (m.method === "ui/notifications/tool-result") {
        var pr = m.params || {};
        latest = pr.structuredContent != null ? pr.structuredContent : pr;
        emit();
        setTimeout(notifySize, 50);
      }
    });
    function notifySize() {
      try {
        send({
          jsonrpc: "2.0",
          method: "ui/notifications/size-changed",
          params: { width: document.body.clientWidth, height: document.body.scrollHeight },
        });
      } catch (e) {}
    }
    request("ui/initialize", {
      protocolVersion: "2026-01-26",
      capabilities: {},
      clientInfo: { name: "aichart-widget", version: "1.0.0" },
      appCapabilities: { availableDisplayModes: ["inline"] },
    })
      .then(function () {
        send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
      })
      .catch(function () {});
    finishApi({
      host: "mcp-apps",
      callTool: function (name, args) {
        return request("tools/call", { name: name, arguments: args || {} }).then(function (r) {
          return normalizeToolResult(r);
        });
      },
      sendFollowUpMessage: function (text) {
        send({ type: "prompt", payload: { prompt: text } });
        return request("ui/send-message", { text: text }).catch(function () {});
      },
      openLink: function (url) {
        request("ui/open-link", { url: url }).catch(function () {
          window.open(url, "_blank");
        });
      },
      notifySize: notifySize,
    });
    window.addEventListener("load", function () { setTimeout(notifySize, 100); });
  }
})();
`;

/** Shared card theme - Lonora dark, RTL Arabic, no external assets. */
export const THEME_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: transparent; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, "Tahoma", sans-serif;
    direction: rtl; color: #e2e8f0; padding: 4px;
  }
  .card {
    background: linear-gradient(180deg, #12151c 0%, #0d1016 100%);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px; padding: 14px 16px; max-width: 640px;
  }
  .hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .hd .title { font-size: 14px; font-weight: 700; color: #f1f5f9; }
  .hd .brand { font-size: 10px; color: #64748b; letter-spacing: .4px; }
  .muted { color: #94a3b8; font-size: 11px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  .kv { background: rgba(148,163,184,0.06); border-radius: 8px; padding: 8px 10px; }
  .kv .k { font-size: 10px; color: #94a3b8; margin-bottom: 2px; }
  .kv .v { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .green { color: #4ade80; } .red { color: #f87171; } .blue { color: #60a5fa; } .amber { color: #fbbf24; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .badge.buy { background: rgba(34,197,94,.15); color: #4ade80; border: 1px solid rgba(34,197,94,.35); }
  .badge.sell { background: rgba(239,68,68,.15); color: #f87171; border: 1px solid rgba(239,68,68,.35); }
  .badge.wait { background: rgba(251,191,36,.12); color: #fbbf24; border: 1px solid rgba(251,191,36,.3); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { color: #94a3b8; font-weight: 600; text-align: right; padding: 6px 8px; border-bottom: 1px solid rgba(148,163,184,.15); font-size: 10px; }
  td { padding: 7px 8px; border-bottom: 1px solid rgba(148,163,184,.07); font-variant-numeric: tabular-nums; }
  .btn {
    display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
    background: rgba(148,163,184,.1); color: #e2e8f0; border: 1px solid rgba(148,163,184,.25);
    border-radius: 8px; padding: 5px 12px; font-size: 11px; font-weight: 600; font-family: inherit;
    transition: background .15s;
  }
  .btn:hover { background: rgba(148,163,184,.18); }
  .btn.primary { background: rgba(34,197,94,.15); color: #4ade80; border-color: rgba(34,197,94,.4); }
  .btn.danger { background: rgba(239,68,68,.12); color: #f87171; border-color: rgba(239,68,68,.35); }
  .btn.confirming { background: #b45309 !important; color: #fff !important; border-color: #f59e0b !important; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .spacer { flex: 1; }
  .foot { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .empty { text-align: center; color: #64748b; padding: 18px 0; font-size: 12px; }
  .imgwrap { border-radius: 8px; overflow: hidden; border: 1px solid rgba(148,163,184,.15); }
  .imgwrap img { display: block; width: 100%; height: auto; }
  .status { font-size: 11px; color: #94a3b8; min-height: 15px; }
  .status.stale { color: #fbbf24; }
  .status.live { color: #4ade80; }
  .trade-line { font-size: 12px; line-height: 1.55; padding: 6px 0; border-bottom: 1px solid rgba(148,163,184,.12); }
`;

/** Public origin for shared widget assets (runtime.js / theme.css). */
export function publicAssetOrigin(): string {
  const raw =
    process.env.AICHART_PUBLIC_URL ??
    process.env.MCP_PUBLIC_URL ??
    "https://aichart.lork.cloud/mcp";
  try {
    return new URL(raw).origin;
  } catch {
    return "https://aichart.lork.cloud";
  }
}

export const STATIC_ASSETS = {
  runtimeJs: { path: "aic-runtime.js", body: RUNTIME_JS, mimeType: "application/javascript; charset=utf-8" },
  themeCss: { path: "aic-theme.css", body: THEME_CSS, mimeType: "text/css; charset=utf-8" },
} as const;

/** Slim shell (~3–5 KB) — heavy runtime/CSS loaded from /mcp-ui/*. */
export function widgetHtml(title: string, body: string, script: string): string {
  const base = publicAssetOrigin();
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="${base}/mcp-ui/aic-theme.css" />
</head>
<body>
${body}
<script src="${base}/mcp-ui/aic-runtime.js" defer></script>
<script defer>${script}</script>
</body>
</html>`;
}
