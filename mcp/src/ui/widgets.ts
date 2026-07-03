import { widgetHtml, RUNTIME_JS } from "./runtime.js";

const PLATFORM_URL = process.env.AICHART_PUBLIC_URL ?? "https://aichart.lork.cloud";

/* ────────────────────────── account-overview ────────────────────────── */
const accountOverview = widgetHtml(
  "نظرة الحساب — AiChart",
  `<div class="card">
    <div class="hd"><span class="title">نظرة الحساب</span><span class="brand">AiChart</span></div>
    <div id="grid" class="grid"><div class="empty">جاري التحميل…</div></div>
    <div class="foot">
      <span id="status" class="status"></span>
      <span class="spacer"></span>
      <button class="btn" id="openPlatform">فتح المنصة</button>
    </div>
  </div>`,
  `
  var LABELS = {
    balance: "الرصيد", equity: "حقوق الملكية", margin: "الهامش",
    free_margin: "الهامش الحر", freeMargin: "الهامش الحر", margin_level: "مستوى الهامش",
    pnl: "الربح/الخسارة", todayPnl: "ربح اليوم", today_pnl: "ربح اليوم",
    openTrades: "صفقات مفتوحة", open_trades: "صفقات مفتوحة", currency: "العملة",
    leverage: "الرافعة", mode: "الوضع", executionEnv: "بيئة التنفيذ",
  };
  function flat(obj, out, depth) {
    out = out || {}; depth = depth || 0;
    if (!obj || typeof obj !== "object" || depth > 2) return out;
    for (var k in obj) {
      var v = obj[k];
      if (v == null) continue;
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
        if (!(k in out)) out[k] = v;
      } else if (typeof v === "object" && !Array.isArray(v)) flat(v, out, depth + 1);
    }
    return out;
  }
  window.__aicReady = function (AIC) {
    AIC.onData(function (data) {
      if (!data) return;
      var f = flat(data);
      var grid = document.getElementById("grid");
      grid.innerHTML = "";
      var shown = 0;
      for (var k in LABELS) {
        if (!(k in f)) continue;
        var v = f[k];
        var cls = "";
        if (typeof v === "number" && /pnl/i.test(k)) cls = v >= 0 ? "green" : "red";
        var el = document.createElement("div");
        el.className = "kv";
        el.innerHTML = '<div class="k">' + LABELS[k] + '</div><div class="v ' + cls + '">' +
          (typeof v === "number" ? AIC.fmt(v, 2) : String(v)) + "</div>";
        grid.appendChild(el);
        if (++shown >= 8) break;
      }
      if (!shown) grid.innerHTML = '<div class="empty">لا بيانات حساب متاحة</div>';
      AIC.notifySize();
    });
    document.getElementById("openPlatform").addEventListener("click", function () {
      AIC.openLink("${PLATFORM_URL}/console");
    });
  };
  `,
);

/* ────────────────────────── market-snapshot ────────────────────────── */
const marketSnapshot = widgetHtml(
  "سنابشوت السوق — AiChart",
  `<div class="card">
    <div class="hd">
      <span class="title" id="sym">—</span>
      <span id="trend" class="badge wait">—</span>
    </div>
    <div id="grid" class="grid"><div class="empty">جاري التحميل…</div></div>
    <div class="foot">
      <span id="status" class="status"></span>
      <span class="spacer"></span>
      <button class="btn" id="openChart">فتح الشارت</button>
      <button class="btn primary" id="analyze">تحليل AI كامل</button>
    </div>
  </div>`,
  `
  var symbol = "";
  window.__aicReady = function (AIC) {
    AIC.onData(function (data) {
      if (!data) return;
      var s = data.snapshot || data;
      symbol = s.symbol || data.symbol || symbol;
      document.getElementById("sym").textContent = symbol || "السوق";
      var trend = (s.trend || "").toString().toLowerCase();
      var tEl = document.getElementById("trend");
      if (/up|bull|صاعد/.test(trend)) { tEl.className = "badge buy"; tEl.textContent = "اتجاه صاعد"; }
      else if (/down|bear|هابط/.test(trend)) { tEl.className = "badge sell"; tEl.textContent = "اتجاه هابط"; }
      else { tEl.className = "badge wait"; tEl.textContent = trend || "محايد"; }
      var rows = [
        ["السعر", s.price ?? s.close, 5, ""],
        ["RSI", s.rsi14 ?? s.rsi, 1, (s.rsi14 ?? s.rsi) >= 70 ? "red" : (s.rsi14 ?? s.rsi) <= 30 ? "green" : ""],
        ["MACD", s.macd && (s.macd.histogram ?? s.macd.value ?? s.macd), 5, ""],
        ["SMA20", s.sma20, 5, ""],
        ["SMA50", s.sma50, 5, ""],
        ["ATR", s.atr14 ?? s.atr, 5, ""],
      ];
      var grid = document.getElementById("grid");
      grid.innerHTML = "";
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r[1] == null || isNaN(r[1])) continue;
        var el = document.createElement("div");
        el.className = "kv";
        el.innerHTML = '<div class="k">' + r[0] + '</div><div class="v ' + r[3] + '">' + AIC.fmt(r[1], r[2]) + "</div>";
        grid.appendChild(el);
      }
      if (!grid.children.length) grid.innerHTML = '<div class="empty">لا بيانات</div>';
      AIC.notifySize();
    });
    document.getElementById("openChart").addEventListener("click", function () {
      AIC.openLink("${PLATFORM_URL}/chart/" + (symbol || "EURUSD"));
    });
    var btn = document.getElementById("analyze");
    btn.addEventListener("click", function () {
      if (!symbol) return;
      btn.disabled = true;
      document.getElementById("status").textContent = "يجري التحليل الكامل… (قد يستغرق دقيقتين)";
      AIC.callTool("run_market_analysis", { symbol: symbol, interval: "15m" })
        .then(function (r) {
          var rec = r && r.recommendation;
          document.getElementById("status").textContent = rec
            ? "اكتمل التحليل: " + (rec.action === "buy" ? "شراء" : rec.action === "sell" ? "بيع" : "انتظار") +
              " · ثقة " + (rec.confidence ?? "—") + "% — افتح الشارت لرؤية الرسم"
            : "اكتمل التحليل";
        })
        .catch(function (e) { document.getElementById("status").textContent = "تعذّر التحليل: " + e.message; })
        .finally(function () { btn.disabled = false; AIC.notifySize(); });
    });
  };
  `,
);

/* ────────────────────────── open-trades ────────────────────────── */
const openTrades = widgetHtml(
  "الصفقات المفتوحة — AiChart",
  `<div class="card">
    <div class="hd"><span class="title">الصفقات المفتوحة</span><span class="brand">AiChart</span></div>
    <div id="body"><div class="empty">جاري التحميل…</div></div>
    <div class="foot"><span id="status" class="status"></span></div>
  </div>`,
  `
  function pickTrades(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.trades || data.rows || data.positions || data.open_trades || [];
  }
  window.__aicReady = function (AIC) {
    AIC.onData(function (data) {
      var trades = pickTrades(data);
      var body = document.getElementById("body");
      if (!trades.length) {
        body.innerHTML = '<div class="empty">لا توجد صفقات مفتوحة</div>';
        AIC.notifySize();
        return;
      }
      var html = '<table><tr><th>الزوج</th><th>الاتجاه</th><th>الحجم</th><th>الدخول</th><th>P/L</th><th></th></tr>';
      for (var i = 0; i < trades.length && i < 10; i++) {
        var t = trades[i];
        var side = (t.side || t.action || t.type || "").toString().toLowerCase();
        var pnl = t.pnl ?? t.profit ?? t.unrealized_pnl;
        html += "<tr>" +
          "<td><b>" + (t.symbol || "—") + "</b></td>" +
          '<td><span class="badge ' + (/buy|long/.test(side) ? "buy" : "sell") + '">' + (/buy|long/.test(side) ? "شراء" : "بيع") + "</span></td>" +
          "<td>" + AIC.fmt(t.lots ?? t.qty ?? t.notional, 2) + "</td>" +
          "<td>" + AIC.fmt(t.entry ?? t.entry_price ?? t.open_price, 5) + "</td>" +
          '<td class="' + (pnl >= 0 ? "green" : "red") + '">' + AIC.fmt(pnl, 2) + "</td>" +
          '<td><button class="btn danger close-btn" data-ticket="' + (t.ticket ?? t.id ?? "") + '" data-symbol="' + (t.symbol || "") + '">إغلاق</button></td>' +
          "</tr>";
      }
      html += "</table>";
      body.innerHTML = html;
      var btns = body.querySelectorAll(".close-btn");
      for (var j = 0; j < btns.length; j++) {
        (function (btn) {
          AIC.bindConfirm(btn, function () {
            btn.disabled = true;
            document.getElementById("status").textContent = "جاري الإغلاق…";
            AIC.callTool("close_trade", {
              ticket: btn.dataset.ticket ? Number(btn.dataset.ticket) : undefined,
              symbol: btn.dataset.symbol || undefined,
            })
              .then(function () {
                document.getElementById("status").textContent = "أُغلقت الصفقة ✓";
                btn.closest("tr").style.opacity = "0.35";
              })
              .catch(function (e) {
                document.getElementById("status").textContent = "فشل الإغلاق: " + e.message;
                btn.disabled = false;
              });
          });
        })(btns[j]);
      }
      AIC.notifySize();
    });
  };
  `,
);

/* ────────────────────────── recommendation-card ────────────────────────── */
const recommendationCard = widgetHtml(
  "توصية AiChart",
  `<div class="card">
    <div class="hd">
      <span class="title" id="sym">توصية</span>
      <span id="action" class="badge wait">—</span>
    </div>
    <div id="grid" class="grid"><div class="empty">جاري التحميل…</div></div>
    <div id="reason" class="muted" style="margin-top:8px; line-height:1.6;"></div>
    <div class="foot">
      <span id="status" class="status"></span>
      <span class="spacer"></span>
      <button class="btn primary" id="openChart">افتح الشارت — الرسم جاهز</button>
    </div>
  </div>`,
  `
  var chartUrl = "${PLATFORM_URL}/chart";
  window.__aicReady = function (AIC) {
    AIC.onData(function (data) {
      if (!data) return;
      var rec = data.recommendation || data;
      var sym = rec.symbol || data.symbol || "";
      document.getElementById("sym").textContent = sym ? "توصية " + sym : "توصية";
      var a = (rec.action || "wait").toLowerCase();
      var badge = document.getElementById("action");
      badge.className = "badge " + (a === "buy" ? "buy" : a === "sell" ? "sell" : "wait");
      badge.textContent = a === "buy" ? "شراء" : a === "sell" ? "بيع" : "انتظار";
      var targets = data.targets && data.targets.length ? data.targets : (rec.take_profit ? [rec.take_profit] : []);
      var rr = null;
      if (rec.entry && rec.stop_loss && targets[0]) {
        var risk = Math.abs(rec.entry - rec.stop_loss);
        if (risk > 0) rr = Math.abs(targets[0] - rec.entry) / risk;
      }
      var rows = [
        ["الدخول", rec.entry, "green"],
        ["وقف الخسارة", rec.stop_loss, "red"],
        ["الهدف 1", targets[0], "blue"],
        ["الهدف 2", targets[1], "blue"],
        ["الثقة", rec.confidence != null ? rec.confidence + "%" : null, ""],
        ["عائد/مخاطرة", rr != null ? "1:" + rr.toFixed(1) : null, "amber"],
      ];
      var grid = document.getElementById("grid");
      grid.innerHTML = "";
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][1] == null) continue;
        var el = document.createElement("div");
        el.className = "kv";
        el.innerHTML = '<div class="k">' + rows[i][0] + '</div><div class="v ' + rows[i][2] + '">' +
          (typeof rows[i][1] === "number" ? AIC.fmt(rows[i][1], 5) : rows[i][1]) + "</div>";
        grid.appendChild(el);
      }
      var reason = (data.reply || rec.rationale || rec.reason || "").toString();
      document.getElementById("reason").textContent = reason.length > 260 ? reason.slice(0, 260) + "…" : reason;
      if (data.layout_id) chartUrl = "${PLATFORM_URL}/chart/" + data.layout_id + (sym ? "?symbol=" + sym : "");
      else if (sym) chartUrl = "${PLATFORM_URL}/chart/" + sym;
      document.getElementById("status").textContent = data.applied_to_chart ? "✓ رُسمت المستويات على شارتك" : "";
      AIC.notifySize();
    });
    document.getElementById("openChart").addEventListener("click", function () {
      AIC.openLink(chartUrl);
    });
  };
  `,
);

/* ────────────────────────── chart-drawn ────────────────────────── */
const chartDrawn = widgetHtml(
  "رسم على الشارت — AiChart",
  `<div class="card">
    <div class="hd"><span class="title">✏️ رسم على شارتك</span><span class="brand">AiChart</span></div>
    <div id="summary" class="muted" style="line-height:1.7;">جاري التحميل…</div>
    <div class="foot">
      <span id="status" class="status"></span>
      <span class="spacer"></span>
      <button class="btn danger" id="clearBtn">مسح الرسومات</button>
      <button class="btn primary" id="openChart">افتح الشارت</button>
    </div>
  </div>`,
  `
  var layoutId = null, chartUrl = "${PLATFORM_URL}/chart";
  window.__aicReady = function (AIC) {
    AIC.onData(function (data) {
      if (!data) return;
      layoutId = data.id || null;
      var sym = data.symbol || "";
      if (data.url) chartUrl = "${PLATFORM_URL}" + data.url;
      document.getElementById("summary").innerHTML =
        (data.ok ? "تم الرسم بنجاح على شارت <b>" + sym + "</b> (" + (data.interval || "") + ")" : "تعذّر الرسم") +
        (data.drawings_count != null ? " — عدد العناصر: <b>" + data.drawings_count + "</b>" : "") +
        '<br><span class="muted">الشارت المفتوح يلتقط الرسم تلقائياً خلال ثوانٍ.</span>';
      AIC.notifySize();
    });
    document.getElementById("openChart").addEventListener("click", function () {
      AIC.openLink(chartUrl);
    });
    var clearBtn = document.getElementById("clearBtn");
    AIC.bindConfirm(clearBtn, function () {
      clearBtn.disabled = true;
      AIC.callTool("clear_chart_drawings", layoutId ? { layout_id: layoutId } : {})
        .then(function () { document.getElementById("status").textContent = "مُسحت الرسومات ✓"; })
        .catch(function (e) { document.getElementById("status").textContent = "فشل المسح: " + e.message; })
        .finally(function () { clearBtn.disabled = false; });
    });
  };
  `,
);

/* ─────────────────────────────── portfolio ───────────────────────────────
 * Flagship card (get_portfolio). Luxury dark RTL design with equity headline,
 * tabs (overview / trades / signals), symbol filter, and a refresh that calls
 * the tool back. Uses its own stylesheet (not THEME_CSS) but the shared AIC
 * runtime, so it lights up identically on Claude (MCP Apps) and ChatGPT.
 * structuredContent render-data shape:
 *   { account:{login,broker,currency,balance,equity,online,lastHeartbeat},
 *     todayPnl, openTrades, trades:[{sym,side,qty,price,pnl,at}],
 *     signals:[{sym,side,entry,sl,tp,pat,blocked}] }
 */
const PORTFOLIO_CSS = `
  :root{
    --bg:#0E1116; --surface:#171B22; --surface-2:#1E242D;
    --line:#262C36; --line-soft:#20262F;
    --txt:#E6E9EF; --muted:#8A93A3; --faint:#5C6674;
    --gold:#E0B15E; --up:#3FB27F; --down:#E5636B;
    --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  }
  *{box-sizing:border-box}
  html,body{margin:0;background:transparent}
  body{color:var(--txt);font-family:var(--sans);font-size:14px;line-height:1.4;padding:4px;-webkit-font-smoothing:antialiased}
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  .card{max-width:520px;margin:0 auto;background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.35)}
  .hd{display:flex;align-items:center;gap:10px;padding:14px 16px 12px;border-bottom:1px solid var(--line-soft)}
  .brand{display:flex;align-items:baseline;gap:7px}
  .brand b{font-weight:700;letter-spacing:.2px}
  .brand b .ai{color:var(--gold)}
  .brand small{color:var(--faint);font-family:var(--mono);font-size:11px}
  .hd .spacer{flex:1}
  .pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:4px 9px;border-radius:999px;border:1px solid var(--line)}
  .pill .dot{width:7px;height:7px;border-radius:50%}
  .pill.off{color:var(--down);border-color:#3a2429;background:#22151799}
  .pill.off .dot{background:var(--down)}
  .pill.on{color:var(--up);border-color:#1e352b;background:#14211b99}
  .pill.on .dot{background:var(--up);box-shadow:0 0 0 3px #3fb27f33}
  .refresh{appearance:none;background:var(--surface-2);color:var(--muted);border:1px solid var(--line);width:30px;height:30px;border-radius:9px;cursor:pointer;display:grid;place-items:center;transition:.15s}
  .refresh:hover{color:var(--txt);border-color:#333c48}
  .refresh:active{transform:rotate(180deg)}
  .refresh svg{width:15px;height:15px}
  .eq{padding:16px}
  .eq .lbl{color:var(--muted);font-size:11px;letter-spacing:.4px;text-transform:uppercase}
  .eq .big{font-family:var(--mono);font-size:32px;font-weight:600;letter-spacing:-.5px;margin-top:2px;font-variant-numeric:tabular-nums}
  .eq .big .cur{color:var(--faint);font-size:17px;margin-inline-start:4px}
  .eq .sub{display:flex;gap:16px;margin-top:10px;flex-wrap:wrap;align-items:center}
  .eq .sub span{color:var(--muted);font-size:12px}
  .eq .sub b{color:var(--txt);font-family:var(--mono);font-variant-numeric:tabular-nums}
  .chip{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-weight:600;padding:3px 9px;border-radius:8px;font-size:13px;font-variant-numeric:tabular-nums}
  .chip.up{color:var(--up);background:#14211b}
  .chip.down{color:var(--down);background:#221517}
  .tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--line-soft)}
  .tab{appearance:none;background:none;border:0;color:var(--muted);font-family:var(--sans);font-size:13px;font-weight:600;padding:11px 12px;cursor:pointer;position:relative;transition:.15s}
  .tab[aria-selected="true"]{color:var(--txt)}
  .tab[aria-selected="true"]::after{content:"";position:absolute;inset-inline:8px;bottom:-1px;height:2px;background:var(--gold);border-radius:2px}
  .tab .n{color:var(--faint);font-family:var(--mono);font-size:11px;margin-inline-start:5px}
  .panel{display:none;padding:12px 14px 16px}
  .panel[data-active]{display:block}
  .stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .stat{background:var(--surface-2);border:1px solid var(--line-soft);border-radius:11px;padding:11px 12px}
  .stat .k{color:var(--muted);font-size:11px}
  .stat .v{font-family:var(--mono);font-size:17px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums}
  .wl{display:flex;align-items:baseline;gap:8px}
  .wl .w{color:var(--up)} .wl .l{color:var(--down)}
  .barwl{height:5px;border-radius:3px;margin-top:9px;overflow:hidden;display:flex;background:#221517}
  .barwl i{display:block;height:100%;background:var(--up)}
  .filters{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
  .filters button{appearance:none;background:var(--surface-2);border:1px solid var(--line-soft);color:var(--muted);font-size:11px;font-weight:600;padding:5px 10px;border-radius:999px;cursor:pointer;transition:.12s;font-family:var(--sans)}
  .filters button[data-on]{color:var(--bg);background:var(--gold);border-color:var(--gold)}
  .list{max-height:280px;overflow:auto;margin:0 -4px;padding:0 4px}
  .list::-webkit-scrollbar{width:6px} .list::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
  .row{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--line-soft)}
  .row:last-child{border-bottom:0}
  .side{width:36px;height:34px;border-radius:9px;display:grid;place-items:center;font-size:10px;font-weight:700;flex:none;font-family:var(--mono)}
  .side.buy{color:var(--up);background:#14211b} .side.sell{color:var(--down);background:#221517}
  .row .mid{flex:1;min-width:0}
  .row .sym{font-weight:600;font-size:13px}
  .row .meta{color:var(--faint);font-size:11px;font-family:var(--mono);margin-top:1px}
  .row .pnl{font-family:var(--mono);font-weight:600;font-variant-numeric:tabular-nums;font-size:13px;text-align:end}
  .row .pnl small{display:block;color:var(--faint);font-weight:400;font-size:10px}
  .pos{color:var(--up)} .neg{color:var(--down)}
  .sigrow{display:block;padding:10px 4px;border-bottom:1px solid var(--line-soft)}
  .sigrow:last-child{border-bottom:0}
  .sighd{display:flex;align-items:center;gap:8px}
  .badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;font-family:var(--mono)}
  .badge.blocked{color:var(--down);background:#221517;border:1px solid #3a2429}
  .badge.open{color:var(--gold);background:#211c12;border:1px solid #3a3016}
  .lvls{display:flex;gap:12px;margin-top:5px;font-family:var(--mono);font-size:11px}
  .lvls span{color:var(--faint)} .lvls b{font-variant-numeric:tabular-nums}
  .lvls .e{color:var(--txt)} .lvls .sl{color:var(--down)} .lvls .tp{color:var(--up)}
  .pat{color:var(--muted);font-size:11px;margin-top:4px;font-style:italic}
  .foot{padding:9px 16px;border-top:1px solid var(--line-soft);color:var(--faint);font-size:10px;font-family:var(--mono);display:flex;justify-content:space-between;align-items:center}
  .empty{color:var(--faint);text-align:center;padding:24px;font-size:12px}
`;

const PORTFOLIO_SCRIPT = `
(function(){
  var DATA = {
    account:{login:"—",broker:"—",currency:"USD",balance:0,equity:0,online:false,lastHeartbeat:"—"},
    todayPnl:0, openTrades:0, trades:[], signals:[]
  };
  function money(n,d){ if(d==null)d=2; if(n==null||isNaN(n))return "—";
    return (n<0?"\\u2212":"")+"$"+Math.abs(Number(n)).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}); }
  function px(n){ if(n==null||isNaN(n))return "—"; n=Number(n);
    return n>=1000 ? n.toLocaleString("en-US",{maximumFractionDigits:2}) : n.toLocaleString("en-US",{maximumFractionDigits:4}); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }

  /* Accept card-shaped data as-is; defensively map a raw bridge payload. */
  function normalize(d){
    if(!d || typeof d!=="object") return DATA;
    if(d.account && d.trades) return d;
    if(d.forex || d.openTrades || d.recentTrades){
      var ea=(d.forex&&d.forex.ea)||{}, meta=(d.forex&&d.forex.metaapi)||{};
      var open=Array.isArray(d.openTrades)?d.openTrades:[];
      var recent=Array.isArray(d.recentTrades)?d.recentTrades:[];
      var recs=Array.isArray(d.recommendations)?d.recommendations:[];
      return {
        account:{
          login:ea.account_login||meta.account_login||"—",
          broker:ea.broker_name||meta.broker_name||"—",
          currency:ea.account_currency||meta.account_currency||"USD",
          balance:ea.balance!=null?ea.balance:(meta.balance!=null?meta.balance:0),
          equity:ea.equity!=null?ea.equity:(meta.equity!=null?meta.equity:0),
          online:!!ea.online,
          lastHeartbeat:ea.last_heartbeat_at||"—"
        },
        todayPnl:d.todayRealizedPnlUsd!=null?d.todayRealizedPnlUsd:0,
        openTrades:open.length,
        trades:recent.map(function(t){return {sym:t.symbol,side:(t.side||"").toLowerCase(),qty:t.qty,price:t.avg_price,pnl:t.pnl,at:(t.created_at||"").slice(11,16)};}),
        signals:recs.map(function(r){var a=(r.action||"").toLowerCase();return {sym:r.symbol,side:a==="sell"?"sell":"buy",entry:r.entry,sl:r.stop_loss,tp:r.take_profit,pat:r.pattern_name||"",blocked:a==="wait"||a==="hold"};})
      };
    }
    return DATA;
  }

  function render(){
    var a=DATA.account, T=DATA.trades||[], S=DATA.signals||[];
    var wins=T.filter(function(t){return t.pnl>0;}).length;
    var losses=T.filter(function(t){return t.pnl<=0;}).length;
    var wr=T.length?Math.round(wins/T.length*100):0;
    var up=(DATA.todayPnl||0)>=0;
    var h="";
    h+='<div class="hd"><div class="brand"><b><span class="ai">Ai</span>Chart</b><small>#'+esc(a.login)+" \\u00b7 "+esc(a.broker)+'</small></div><div class="spacer"></div>';
    h+='<span class="pill '+(a.online?"on":"off")+'"><span class="dot"></span>'+(a.online?"\\u0645\\u062a\\u0635\\u0644":"\\u063a\\u064a\\u0631 \\u0645\\u062a\\u0635\\u0644")+"</span>";
    h+='<button class="refresh" id="rf" title="\\u062a\\u062d\\u062f\\u064a\\u062b" aria-label="\\u062a\\u062d\\u062f\\u064a\\u062b"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button></div>';
    h+='<div class="eq"><div class="lbl">\\u0627\\u0644\\u0625\\u064a\\u0643\\u0648\\u064a\\u062a\\u064a</div><div class="big">'+px(a.equity)+'<span class="cur">'+esc(a.currency)+'</span></div>';
    h+='<div class="sub"><span>\\u0627\\u0644\\u0631\\u0635\\u064a\\u062f <b>'+money(a.balance)+'</b></span><span>\\u0631\\u0628\\u062d \\u0627\\u0644\\u064a\\u0648\\u0645 <span class="chip '+(up?"up":"down")+'">'+(up?"\\u25b2":"\\u25bc")+" "+money(DATA.todayPnl)+"</span></span></div></div>";
    h+='<div class="tabs" role="tablist"><button class="tab" role="tab" data-tab="ov" aria-selected="true">\\u0646\\u0638\\u0631\\u0629 \\u0639\\u0627\\u0645\\u0629</button>';
    h+='<button class="tab" role="tab" data-tab="tr" aria-selected="false">\\u0627\\u0644\\u0635\\u0641\\u0642\\u0627\\u062a<span class="n">'+T.length+'</span></button>';
    h+='<button class="tab" role="tab" data-tab="sg" aria-selected="false">\\u0627\\u0644\\u062a\\u0648\\u0635\\u064a\\u0627\\u062a<span class="n">'+S.length+"</span></button></div>";
    /* overview */
    h+='<div class="panel" data-panel="ov" data-active><div class="stats">';
    h+='<div class="stat"><div class="k">\\u0635\\u0641\\u0642\\u0627\\u062a \\u0645\\u0641\\u062a\\u0648\\u062d\\u0629</div><div class="v">'+DATA.openTrades+"</div></div>";
    h+='<div class="stat"><div class="k">\\u0646\\u0633\\u0628\\u0629 \\u0627\\u0644\\u0631\\u0628\\u062d \\u00b7 \\u0622\\u062e\\u0631 '+T.length+'</div><div class="v">'+wr+'<span style="font-size:12px;color:var(--muted)">%</span></div><div class="wl" style="font-size:11px;margin-top:2px"><span class="w">'+wins+' \\u0631\\u0628\\u062d</span><span class="l">'+losses+' \\u062e\\u0633\\u0627\\u0631\\u0629</span></div><div class="barwl"><i style="width:'+wr+'%"></i></div></div>';
    h+='<div class="stat"><div class="k">\\u062d\\u0627\\u0644\\u0629 \\u0627\\u0644\\u062c\\u0633\\u0631 (EA)</div><div class="v" style="font-size:14px;color:'+(a.online?"var(--up)":"var(--down)")+'">'+(a.online?"\\u064a\\u0639\\u0645\\u0644":"\\u0645\\u062a\\u0648\\u0642\\u0641")+'</div><div style="color:var(--faint);font-size:10px;font-family:var(--mono);margin-top:3px">\\u0622\\u062e\\u0631 \\u0646\\u0628\\u0636\\u0629 '+esc(a.lastHeartbeat)+"</div></div>";
    h+='<div class="stat"><div class="k">\\u0646\\u0648\\u0639 \\u0627\\u0644\\u062d\\u0633\\u0627\\u0628</div><div class="v" style="font-size:14px">\\u062d\\u0642\\u064a\\u0642\\u064a \\u00b7 '+esc(a.currency)+'</div><div style="color:var(--faint);font-size:10px;font-family:var(--mono);margin-top:3px">MT5 \\u00b7 '+esc(a.broker)+"</div></div>";
    h+="</div></div>";
    /* trades */
    h+='<div class="panel" data-panel="tr"><div class="filters" id="flt"><button data-f="all" data-on>\\u0627\\u0644\\u0643\\u0644</button></div><div class="list" id="trlist"></div></div>';
    /* signals */
    h+='<div class="panel" data-panel="sg"><div class="list">';
    if(!S.length){ h+='<div class="empty">\\u0644\\u0627 \\u062a\\u0648\\u0635\\u064a\\u0627\\u062a \\u0627\\u0644\\u0622\\u0646</div>'; }
    for(var i=0;i<S.length;i++){ var s=S[i];
      h+='<div class="sigrow"><div class="sighd"><span class="side '+(s.side==="sell"?"sell":"buy")+'" style="width:auto;height:auto;padding:2px 6px">'+(s.side==="sell"?"\\u0628\\u064a\\u0639":"\\u0634\\u0631\\u0627\\u0621")+'</span><b style="font-size:13px">'+esc(s.sym)+'</b><span class="badge '+(s.blocked?"blocked":"open")+'">'+(s.blocked?"\\u0645\\u062d\\u0638\\u0648\\u0631\\u0629":"\\u0642\\u0627\\u0628\\u0644\\u0629 \\u0644\\u0644\\u062a\\u0646\\u0641\\u064a\\u0630")+"</span></div>";
      h+='<div class="lvls"><span>\\u062f\\u062e\\u0648\\u0644 <b class="e">'+px(s.entry)+'</b></span><span>\\u0648\\u0642\\u0641 <b class="sl">'+px(s.sl)+'</b></span><span>\\u0647\\u062f\\u0641 <b class="tp">'+px(s.tp)+"</b></span></div>";
      if(s.pat) h+='<div class="pat">'+esc(s.pat)+"</div>";
      h+="</div>";
    }
    h+="</div></div>";
    h+='<div class="foot"><span>get_portfolio</span><span>\\u0645\\u062d\\u062f\\u0651\\u062b \\u0627\\u0644\\u0622\\u0646</span></div>';

    var card=document.getElementById("card");
    card.innerHTML=h;

    /* symbol filter chips derived from trades */
    var syms=[]; for(var j=0;j<T.length;j++){ var base=(T[j].sym||"").replace(/m$/i,"").slice(0,3); if(base && syms.indexOf(base)<0) syms.push(base); }
    var flt=document.getElementById("flt");
    for(var k=0;k<syms.length && k<4;k++){ var b=document.createElement("button"); b.setAttribute("data-f",syms[k]); b.textContent=syms[k]; flt.appendChild(b); }

    card.querySelectorAll(".tab").forEach(function(t){ t.onclick=function(){
      card.querySelectorAll(".tab").forEach(function(x){ x.setAttribute("aria-selected", x===t?"true":"false"); });
      card.querySelectorAll(".panel").forEach(function(p){ if(p.getAttribute("data-panel")===t.getAttribute("data-tab")) p.setAttribute("data-active",""); else p.removeAttribute("data-active"); });
    };});

    function drawTrades(f){
      var out=""; var list=T.filter(function(t){ return f==="all" || (t.sym||"").toUpperCase().indexOf(f.toUpperCase())===0; });
      for(var m=0;m<list.length;m++){ var t=list[m]; var closed=t.at ? t.at : "";
        out+='<div class="row"><div class="side '+(t.side==="sell"?"sell":"buy")+'">'+(t.side==="sell"?"SELL":"BUY")+'</div><div class="mid"><div class="sym">'+esc(t.sym)+'</div><div class="meta">'+px(t.qty)+" @ "+px(t.price)+(closed?(" \\u00b7 "+esc(closed)):"")+'</div></div><div class="pnl '+(t.pnl>=0?"pos":"neg")+'">'+money(t.pnl)+"</div></div>";
      }
      var el=document.getElementById("trlist"); el.innerHTML = out || '<div class="empty">\\u0644\\u0627 \\u0635\\u0641\\u0642\\u0627\\u062a</div>';
    }
    drawTrades("all");
    card.querySelectorAll("#flt button").forEach(function(b){ b.onclick=function(){
      card.querySelectorAll("#flt button").forEach(function(x){ x.removeAttribute("data-on"); });
      b.setAttribute("data-on","");
      drawTrades(b.getAttribute("data-f"));
    };});

    var rf=document.getElementById("rf");
    if(rf) rf.onclick=function(){ rf.disabled=true; AIC.callTool("get_portfolio",{}).then(function(d){ if(d){ DATA=normalize(d); render(); } }).catch(function(){}).finally(function(){ if(rf) rf.disabled=false; }); };
    if(AIC && AIC.notifySize) setTimeout(AIC.notifySize,60);
  }

  function boot(api){
    var d=api.getData && api.getData();
    if(d){ DATA=normalize(d); }
    render();
    api.onData(function(x){ if(x){ DATA=normalize(x); render(); } });
  }
  if(window.AIC){ boot(window.AIC); } else { window.__aicReady=boot; }
})();
`;

const portfolio = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AiChart — بطاقة الحساب</title>
<style>${PORTFOLIO_CSS}</style>
</head>
<body>
<div class="card" id="card"></div>
<script>${RUNTIME_JS}</script>
<script>${PORTFOLIO_SCRIPT}</script>
</body>
</html>`;

export const WIDGETS: Record<string, string> = {
  "account-overview": accountOverview,
  "market-snapshot": marketSnapshot,
  "open-trades": openTrades,
  "recommendation-card": recommendationCard,
  "chart-drawn": chartDrawn,
  portfolio,
};
