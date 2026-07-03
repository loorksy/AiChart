import { widgetHtml } from "./runtime.js";

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

export const WIDGETS: Record<string, string> = {
  "account-overview": accountOverview,
  "market-snapshot": marketSnapshot,
  "open-trades": openTrades,
  "recommendation-card": recommendationCard,
  "chart-drawn": chartDrawn,
};
