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
    window.AIC = api;
    if (window.__aicReady) { try { window.__aicReady(api); } catch (e) {} }
  }

  if (window.openai) {
    /* ── ChatGPT (Apps SDK / skybridge) ── */
    latest = window.openai.toolOutput || null;
    window.addEventListener("openai:set_globals", function () {
      latest = window.openai.toolOutput || latest;
      emit();
    });
    finishApi({
      host: "chatgpt",
      callTool: function (name, args) {
        return window.openai.callTool(name, args || {}).then(function (r) {
          return (r && r.structuredContent) || r;
        });
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
      if (!m || m.jsonrpc !== "2.0") return;
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
          return (r && r.structuredContent) || r;
        });
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

/** Shared card theme — AiChart dark, RTL Arabic, no external assets. */
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
    border-radius: 14px; padding: 14px 16px; max-width: 640px;
  }
  .hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .hd .title { font-size: 14px; font-weight: 700; color: #f1f5f9; }
  .hd .brand { font-size: 10px; color: #64748b; letter-spacing: .4px; }
  .muted { color: #94a3b8; font-size: 11px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  .kv { background: rgba(148,163,184,0.06); border-radius: 10px; padding: 8px 10px; }
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
  .imgwrap { border-radius: 10px; overflow: hidden; border: 1px solid rgba(148,163,184,.15); }
  .imgwrap img { display: block; width: 100%; height: auto; }
  .status { font-size: 11px; color: #94a3b8; min-height: 15px; }
`;

/** Full HTML document for a widget. */
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
