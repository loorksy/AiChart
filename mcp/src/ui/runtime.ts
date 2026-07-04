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

  /* Card scripts run AFTER this runtime and only assign window.__aicReady —
     an interception setter fires the callback immediately once both sides
     exist, regardless of load order. */
  var readyCb = null, readyFired = false;
  function fireReady() {
    if (readyFired || !window.AIC || typeof readyCb !== "function") return;
    readyFired = true;
    try { readyCb(window.AIC); } catch (e) {}
  }
  try {
    Object.defineProperty(window, "__aicReady", {
      configurable: true,
      get: function () { return readyCb; },
      set: function (fn) { readyCb = fn; fireReady(); },
    });
  } catch (e) {}

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
      el.className = s.label ? "status " + (s.stale ? "stale" : "live") : "status";
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
    /* If the host never delivers data, swap loading skeletons for an honest
       empty state instead of pulsing forever. */
    setTimeout(function () {
      if (latest != null) return;
      var sk = document.querySelectorAll(".skel");
      if (!sk.length) return;
      var parent = sk[0].parentNode;
      if (parent) parent.innerHTML = '<div class="empty">لم تصل بيانات من الأداة بعد — جرّب زر التحديث أو أعد استدعاء الأداة.</div>';
    }, 6000);
    fireReady();
  }

  /* Newer web routes (withBridge) wrap payloads as {ok, data, meta}; older
     ones return bare JSON. Unwrap centrally so EVERY card reads the real
     payload — never {ok,data} whose fields all read as missing. Envelopes
     that carry their fields alongside ok (e.g. create_recommendation) are
     left intact (no inner data object). */
  function unwrapEnvelope(d) {
    if (d && typeof d === "object" && !Array.isArray(d) &&
        (d.ok === true || d.ok === false) &&
        d.data && typeof d.data === "object") {
      return d.data;
    }
    return d;
  }

  function normalizeToolResult(r) {
    if (r && r.structuredContent) return unwrapEnvelope(r.structuredContent);
    /* Tools without structuredContent carry JSON in the text block. */
    if (r && Array.isArray(r.content)) {
      for (var i = 0; i < r.content.length; i++) {
        var c = r.content[i];
        if (c && c.type === "text" && typeof c.text === "string") {
          try {
            var p = JSON.parse(c.text);
            if (p && typeof p === "object") return unwrapEnvelope(p);
          } catch (e) {}
        }
      }
    }
    return r;
  }

  if (window.openai) {
    /* ── ChatGPT (Apps SDK / skybridge) ── */
    function readOpenAiData() {
      var meta = window.openai.toolResponseMetadata || null;
      return unwrapEnvelope(window.openai.toolOutput || (meta && (meta.structuredContent || meta.toolOutput || meta.data)) || meta || null);
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
        latest = unwrapEnvelope(rd.structuredContent || rd.toolOutput || rd.data || rd);
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
        latest = unwrapEnvelope(pr.structuredContent != null ? pr.structuredContent : pr);
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

/** Shared card theme — Lonora premium dark, RTL Arabic, fully inline (the
 *  host iframe sandbox blocks external assets, so no fonts/CDNs/links). */
export const THEME_CSS = `
  :root{
    --bg:#0E1116; --surface:#171B22; --surface-2:#1E242D;
    --line:#262C36; --line-soft:#20262F;
    --txt:#E6E9EF; --muted:#8A93A3; --faint:#5C6674;
    --gold:#E0B15E; --up:#3FB27F; --down:#E5636B; --warn:#D9A441; --info:#7FB4E8;
    --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Tahoma",sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:transparent}
  body{font-family:var(--sans);direction:rtl;color:var(--txt);padding:4px;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  .card{
    background:var(--surface);border:1px solid var(--line);border-radius:16px;
    padding:14px 16px;max-width:560px;margin:0 auto;overflow:hidden;
    box-shadow:0 10px 30px rgba(0,0,0,.35);
  }
  .hd{display:flex;align-items:center;justify-content:space-between;gap:8px;
    margin:-14px -16px 14px;padding:13px 16px;border-bottom:1px solid var(--line-soft);
    background:linear-gradient(180deg,#1A1F27 0%,rgba(26,31,39,0) 140%)}
  .hd .title{font-size:14px;font-weight:700;color:var(--txt);letter-spacing:.2px}
  .hd .brand{font-size:10px;color:var(--gold);letter-spacing:.8px;font-weight:700;text-transform:uppercase}
  .muted{color:var(--muted);font-size:12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
  .kv{background:var(--surface-2);border:1px solid var(--line-soft);border-radius:11px;padding:10px 12px;min-height:56px}
  .kv .k{font-size:11px;color:var(--muted);margin-bottom:4px;letter-spacing:.2px}
  .kv .v{font-size:16px;font-weight:600;font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.2px;word-break:break-word}
  .green{color:var(--up)} .red{color:var(--down)} .blue{color:var(--info)} .amber{color:var(--warn)}
  .badge{display:inline-flex;align-items:center;gap:6px;padding:3px 11px;border-radius:999px;font-size:11px;font-weight:700}
  .badge.buy{background:#14211B;color:var(--up);border:1px solid #1E352B}
  .badge.sell{background:#221517;color:var(--down);border:1px solid #3A2429}
  .badge.wait{background:#211C12;color:var(--gold);border:1px solid #3A3016}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{color:var(--muted);font-weight:600;text-align:right;padding:7px 8px;border-bottom:1px solid var(--line);font-size:11px}
  td{padding:8px;border-bottom:1px solid var(--line-soft);font-variant-numeric:tabular-nums;font-family:var(--mono)}
  .btn{
    display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;
    background:var(--surface-2);color:var(--muted);border:1px solid var(--line);
    border-radius:9px;padding:7px 14px;min-height:32px;font-size:12px;font-weight:600;font-family:var(--sans);
    transition:background .2s,color .2s,border-color .2s;
  }
  .btn:hover{color:var(--txt);border-color:#333C48;background:#232A34}
  .btn:focus-visible{outline:2px solid var(--gold);outline-offset:1px}
  .btn.primary{background:#211C12;color:var(--gold);border-color:#3A3016}
  .btn.primary:hover{background:#2A2416;border-color:#4A3D1E;color:#EBC57E}
  .btn.danger{background:#221517;color:var(--down);border-color:#3A2429}
  .btn.danger:hover{background:#2B1A1D}
  .btn.confirming{background:#B45309!important;color:#fff!important;border-color:#F59E0B!important}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .spacer{flex:1}
  .foot{margin:14px -16px -14px;padding:10px 16px 12px;border-top:1px solid var(--line-soft);
    display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .empty{text-align:center;color:var(--faint);padding:22px 12px;font-size:12px;
    border:1px dashed var(--line);border-radius:11px;grid-column:1/-1}
  .imgwrap{border-radius:11px;overflow:hidden;border:1px solid var(--line)}
  .imgwrap img{display:block;width:100%;height:auto}
  .status{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--muted);min-height:16px}
  .status.stale{color:var(--warn)} .status.live{color:var(--up)}
  .status.live::before,.status.stale::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
  .status.live::before{box-shadow:0 0 0 3px rgba(63,178,127,.2)}
  .trade-line{font-size:12px;line-height:1.6;padding:8px 2px;border-bottom:1px solid var(--line-soft);
    font-family:var(--mono);font-variant-numeric:tabular-nums}
  .trade-line:last-child{border-bottom:0}
  .skel{min-height:56px;border-radius:11px;border:1px solid var(--line-soft);
    background:linear-gradient(90deg,var(--surface-2) 25%,#232A34 40%,var(--surface-2) 60%);
    background-size:300% 100%;animation:skel 1.4s ease infinite}
  @keyframes skel{0%{background-position:100% 0}100%{background-position:-100% 0}}
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

/** Self-contained shell: theme + runtime + card script all inline. Host
 *  sandboxes (Claude MCP Apps) block external assets, so nothing may be
 *  fetched at render time — the /mcp-ui endpoints remain only for legacy
 *  shells and manual inspection. */
export function widgetHtml(title: string, body: string, script: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${THEME_CSS}</style>
</head>
<body>
${body}
<script>${RUNTIME_JS}</script>
<script>${script}</script>
</body>
</html>`;
}
