import { widgetHtml, RUNTIME_JS } from "./runtime.js";

const PLATFORM_URL = process.env.AICHART_PUBLIC_URL ?? "https://aichart.lork.cloud";

const accountOverview = widgetHtml(
  "Lonora account overview",
  `<div class="card">
    <div class="hd"><span class="title">حالة الحساب</span><span class="brand">Lonora</span></div>
    <div id="grid" class="grid"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
    <div class="foot">
      <span id="status" class="status"></span>
      <span class="spacer"></span>
      <button class="btn" id="refresh">تحديث</button>
      <button class="btn primary" id="manage">إدارة الصفقات</button>
    </div>
  </div>`,
  `
  function obj(v) { return v && typeof v === "object" ? v : {}; }
  function first() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  }
  function eaState(data) {
    var live = obj(data.live);
    var forex = obj(live.forex);
    var ea = obj(forex.ea || live.ea || data.ea);
    var fresh = ea.heartbeatFresh === true || ea.online === true || ea.connected === true;
    var stale = ea.heartbeatFresh === false || ea.online === false || ea.connected === false || /offline|stale|down/i.test(String(ea.status || ""));
    return { fresh: fresh && !stale, stale: stale || !fresh, label: fresh && !stale ? "متصل" : "غير متصل / بيانات قديمة" };
  }
  /* Last-known money while stale is shown but explicitly marked قديم;
     a truly missing value hides the row (never renders 0). */
  function moneyCell(AIC, value, stale) {
    if (value == null) return stale ? "— / غير متاح" : null;
    var t = AIC.fmt(value, 2);
    return stale ? t + " · قديم" : t;
  }
  window.__aicReady = function (AIC) {
    var last = null;
    AIC.onData(function (data) {
      data = obj(data); last = data;
      var risk = obj(data.risk);
      var portfolio = obj(data.portfolio);
      var live = obj(data.live);
      var ea = eaState(data);
      /* Source of truth: live EA account meta, then portfolio EA, then legacy keys. */
      var eaLive = obj(obj(live.forex).ea);
      var eaPort = obj(obj(portfolio.forex).ea);
      var legacy = obj(portfolio.account || live.account || data.account);
      var balance = AIC.num(first(eaLive.balance, eaPort.balance, legacy.balance, portfolio.balance, data.balance));
      var equity = AIC.num(first(eaLive.equity, eaPort.equity, legacy.equity, portfolio.equity, data.equity));
      var freeMargin = AIC.num(first(eaLive.freeMargin, eaLive.free_margin, legacy.freeMargin, legacy.free_margin, portfolio.freeMargin));
      var openPnl = AIC.num(first(portfolio.openPnl, portfolio.open_pnl, legacy.openPnl, legacy.pnl, live.openPnl));
      if (openPnl == null) {
        var positions = obj(live.forex).positions;
        if (Array.isArray(positions) && positions.length) {
          var sum = 0, seen = false;
          for (var i = 0; i < positions.length; i++) {
            var pr = AIC.num(positions[i] && positions[i].profit);
            if (pr != null) { sum += pr; seen = true; }
          }
          if (seen) openPnl = sum;
        }
      }
      var rows = [
        ["الرصيد", moneyCell(AIC, balance, ea.stale), ea.stale ? "amber" : ""],
        ["حقوق الملكية", moneyCell(AIC, equity, ea.stale), ea.stale ? "amber" : ""],
        ["الهامش الحر", moneyCell(AIC, freeMargin, ea.stale), ea.stale ? "amber" : ""],
        ["PnL المفتوح", ea.stale ? "— / بيانات قديمة" : moneyCell(AIC, openPnl, false), ea.stale ? "amber" : (Number(openPnl) >= 0 ? "green" : "red")],
        ["إعداد حد الصفقة", first(risk.perTradeMaxUsd, risk.per_trade_max_usd, data.perTradeMaxUsd), "blue"],
        ["حالة المخاطر", first(risk.status, risk.mode, data.risk_status), ""],
        ["الصفقات المفتوحة", AIC.formatOpenTrades(first(portfolio.openTrades, portfolio.open_trades, data.openTrades, data.trades)), ""],
        ["اتصال EA", ea.label, ea.stale ? "amber" : "green"],
      ];
      var grid = document.getElementById("grid");
      grid.innerHTML = "";
      rows.forEach(function (row) {
        var value = AIC.cell(row[1], 2);
        if (value == null) return;
        var el = document.createElement("div");
        el.className = "kv";
        el.innerHTML = '<div class="k">' + row[0] + '</div><div class="v ' + row[2] + '">' + value + '</div>';
        grid.appendChild(el);
      });
      if (!grid.children.length) grid.innerHTML = '<div class="empty">لا توجد بيانات حساب متاحة</div>';
      AIC.applyBridgeBadge(document.getElementById("status"), data);
      if (ea.stale && !document.getElementById("status").textContent) {
        document.getElementById("status").textContent = "EA offline/stale: لا نعرض PnL قديم كأنه صفر.";
      }
      AIC.notifySize();
    });
    document.getElementById("refresh").addEventListener("click", function () {
      AIC.callTool("get_account_overview", {});
    });
    document.getElementById("manage").addEventListener("click", function () {
      AIC.sendFollowUpMessage("افتح لي إدارة الصفقات المفتوحة والمخاطر في Lonora.");
    });
  };
  `,
);

const analysis = widgetHtml(
  "Lonora analysis",
  `<div class="card">
    <div class="hd"><span class="title" id="title">تحليل السوق</span><span id="badge" class="badge wait">Lonora</span></div>
    <div id="grid" class="grid"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
    <div id="summary" class="muted" style="margin-top:10px; line-height:1.7;"></div>
    <div class="foot">
      <span id="status" class="status"></span>
      <span class="spacer"></span>
      <button class="btn" id="refresh">تحديث</button>
      <button class="btn primary" id="deep">تحليل أعمق</button>
    </div>
  </div>`,
  `
  var current = { symbol: "", interval: "15m", layout_id: null, data_source: null };
  function obj(v) { return v && typeof v === "object" ? v : {}; }
  /* Handles: {snapshot}, MTF {snapshots:[{interval,snapshot}]}, detect_levels
     (flat) — and surfaces indicator keys nested under snapshot.extra. */
  function pickSnapshot(data) {
    var s = data.snapshot;
    if (!s && Array.isArray(data.snapshots)) {
      for (var i = 0; i < data.snapshots.length; i++) {
        var it = obj(data.snapshots[i]);
        if (it.snapshot) { s = it.snapshot; break; }
        if (it.price != null || it.close != null) { s = it; break; }
      }
    }
    s = obj(s || data);
    var extra = obj(s.extra);
    var merged = {};
    for (var k in s) merged[k] = s[k];
    for (var k2 in extra) if (merged[k2] == null) merged[k2] = extra[k2];
    return merged;
  }
  function fmtMacd(v) {
    if (v == null) return null;
    if (typeof v === "number") return v;
    return v.histogram ?? v.value ?? v.macd ?? null;
  }
  function trendClass(v) {
    v = String(v || "").toLowerCase();
    if (/up|bull|buy|صاعد/.test(v)) return ["buy", "صاعد"];
    if (/down|bear|sell|هابط/.test(v)) return ["sell", "هابط"];
    return ["wait", v || "محايد"];
  }
  window.__aicReady = function (AIC) {
    AIC.onData(function (data) {
      data = obj(data);
      var snap = pickSnapshot(data);
      var rec = obj(data.recommendation);
      current.symbol = snap.symbol || rec.symbol || data.symbol || current.symbol;
      current.interval = snap.interval || data.interval || current.interval;
      current.layout_id = data.layout_id || current.layout_id;
      current.data_source = data.data_source || data.dataSource || current.data_source;
      var trend = trendClass(rec.action || snap.trend || data.trend);
      document.getElementById("title").textContent = current.symbol ? "تحليل " + current.symbol : "تحليل السوق";
      var badge = document.getElementById("badge");
      badge.className = "badge " + trend[0];
      badge.textContent = rec.action === "buy" ? "شراء" : rec.action === "sell" ? "بيع" : trend[1];
      var targets = data.targets || (rec.take_profit ? [rec.take_profit] : []);
      /* Price-like fields: 0 is never a real market level — treat as missing. */
      function pxv(v) {
        var n = AIC.num(v);
        return n == null || n === 0 ? null : n;
      }
      var rows = [
        ["السعر", pxv(snap.price ?? snap.close ?? snap.currentPrice ?? rec.entry), "blue"],
        ["الاتجاه", snap.trend != null ? trendClass(snap.trend)[1] : null, ""],
        ["التغير 24س", snap.change24hPct != null ? AIC.fmt(snap.change24hPct, 2) + "%" : null,
          Number(snap.change24hPct) >= 0 ? "green" : "red"],
        ["الثقة", rec.confidence != null ? rec.confidence + "%" : data.confidence, ""],
        ["RSI", snap.rsi14 ?? snap.rsi, ""],
        ["MACD", fmtMacd(snap.macd), ""],
        ["الدعم", pxv(snap.support ?? snap.nearestSupport ?? data.support), "green"],
        ["المقاومة", pxv(snap.resistance ?? snap.nearestResistance ?? data.resistance), "red"],
        ["الدخول", pxv(rec.entry), "green"],
        ["الوقف", pxv(rec.stop_loss), "red"],
        ["الهدف", pxv(targets[0]), "blue"],
        ["الرسومات", Array.isArray(data.drawings) ? data.drawings.length : null, ""],
      ];
      var grid = document.getElementById("grid");
      grid.innerHTML = "";
      rows.forEach(function (row) {
        var value = AIC.cell(row[1], 5);
        if (value == null) return;
        var el = document.createElement("div");
        el.className = "kv";
        el.innerHTML = '<div class="k">' + row[0] + '</div><div class="v ' + row[2] + '">' + value + "</div>";
        grid.appendChild(el);
      });
      if (!grid.children.length) grid.innerHTML = '<div class="empty">لا توجد بيانات تحليل متاحة</div>';
      var summary = data.reply || snap.summary || rec.rationale || data.summary || data.contextSummary || "";
      document.getElementById("summary").textContent = String(summary).slice(0, 420);
      document.getElementById("status").textContent = current.data_source ? "مصدر البيانات: " + current.data_source : "";
      AIC.notifySize();
    });
    document.getElementById("refresh").addEventListener("click", function () {
      if (!current.symbol) return;
      AIC.callTool("get_market_snapshot", { symbol: current.symbol, interval: current.interval });
    });
    document.getElementById("deep").addEventListener("click", function () {
      if (!current.symbol && !current.layout_id) return;
      AIC.callTool("run_market_analysis", {
        symbol: current.symbol || undefined,
        interval: current.interval,
        layout_id: current.layout_id || undefined,
        data_source: current.data_source || undefined
      });
    });
  };
  `,
);

function genericCard(title: string, subtitle: string, action?: { label: string; tool: string }) {
  return widgetHtml(
    `Lonora ${title}`,
    `<div class="card">
      <div class="hd"><span class="title">${title}</span><span class="brand">Lonora</span></div>
      <div id="body" class="grid"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
      <div id="summary" class="muted" style="margin-top:10px; line-height:1.7;">${subtitle}</div>
      <div class="foot">
        <span id="status" class="status"></span>
        <span class="spacer"></span>
        ${action ? `<button class="btn primary" id="action">${action.label}</button>` : ""}
      </div>
    </div>`,
    `
    function obj(v) { return v && typeof v === "object" ? v : {}; }
    function rowsFrom(data, AIC) {
      var out = [];
      var trades = AIC.pickTrades(data);
      if (trades.length) out.push(["الصفقات", AIC.formatOpenTrades(trades)]);
      for (var k in data) {
        if (k === "trades" || k === "openTrades" || k === "open_trades") continue;
        var v = data[k];
        if (v == null) continue;
        if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out.push([k, v]);
        if (out.length >= 8) break;
      }
      return out;
    }
    window.__aicReady = function (AIC) {
      AIC.onData(function (data) {
        data = obj(data);
        var body = document.getElementById("body");
        var rows = rowsFrom(data, AIC);
        body.innerHTML = "";
        rows.forEach(function (row) {
          var value = AIC.cell(row[1], 4);
          if (value == null) return;
          var el = document.createElement("div");
          el.className = "kv";
          el.innerHTML = '<div class="k">' + row[0] + '</div><div class="v">' + value + "</div>";
          body.appendChild(el);
        });
        if (!body.children.length) body.innerHTML = '<div class="empty">لا توجد بيانات لهذه البطاقة</div>';
        AIC.applyBridgeBadge(document.getElementById("status"), data);
        AIC.notifySize();
      });
      var btn = document.getElementById("action");
      if (btn) btn.addEventListener("click", function () { AIC.callTool("${action?.tool ?? ""}", {}); });
    };
    `,
  );
}

const openTradesCard = widgetHtml(
  "Lonora open trades",
  `<div class="card">
    <div class="hd"><span class="title">الصفقات المفتوحة</span><span class="brand">Lonora</span></div>
    <div id="trades" class="grid"></div>
    <div class="foot">
      <span id="status" class="status"></span>
      <span class="spacer"></span>
      <button class="btn primary" id="action">تحديث الصفقات</button>
    </div>
  </div>`,
  `
  window.__aicReady = function (AIC) {
    function render(data) {
      data = data || {};
      AIC.applyBridgeBadge(document.getElementById("status"), data);
      var stale = AIC.bridgeLinkState(data).stale;
      var trades = AIC.pickTrades(data);
      var box = document.getElementById("trades");
      if (stale && !trades.length) {
        box.innerHTML = '<div class="empty">الجسر غير متصل أو البيانات قديمة — لا نعرض صفقات وهمية</div>';
      } else {
        AIC.renderTradeLines(box, trades, AIC.fmt.bind(AIC));
      }
      AIC.notifySize();
    }
    AIC.onData(render);
    document.getElementById("action").addEventListener("click", function () {
      AIC.callTool("get_open_trades", {});
    });
  };
  `,
);

/* ────────────────────────────── live chart ──────────────────────────────
 * Canvas mini-chart: candles from get_ohlc + Claude's drawings/recommendation
 * from get_chart_state, refreshed every ~4s via host-mediated callTool.
 * Read-only — no toolbars; one button opens the full TradingView chart. */
const liveChart = widgetHtml(
  "Lonora live chart",
  `<div class="card" style="max-width:640px">
    <div class="hd"><span class="title" id="title">الشارت الحي</span><span class="brand">Lonora</span></div>
    <div style="position:relative">
      <canvas id="cv" style="width:100%;height:300px;display:block;border-radius:11px;background:#0B0E13;border:1px solid #20262F"></canvas>
      <div id="hint" class="empty" style="display:none;position:absolute;inset:0;margin:auto;height:fit-content;background:#171B22">لا يوجد رمز بعد — اطلب من كلود عرض شارت لرمز معين.</div>
    </div>
    <div id="levels" class="muted" style="margin-top:8px;font-variant-numeric:tabular-nums"></div>
    <div class="foot">
      <span id="status" class="status"></span>
      <span id="age" class="muted"></span>
      <span class="spacer"></span>
      <button class="btn" id="pause">إيقاف التحديث</button>
      <button class="btn primary" id="open">فتح الشارت الكامل</button>
    </div>
  </div>`,
  `
  var PLATFORM = "${PLATFORM_URL}";
  var S = { symbol:null, interval:"15m", layoutId:null, url:null, candles:[],
            drawings:[], rec:null, targets:[], lastUpdate:0, paused:false,
            failures:0, timer:null, booted:false, source:null };

  function nnum(v){ v = Number(v); return isFinite(v) ? v : null; }
  function toMs(t){ t = Number(t); if (!isFinite(t) || t <= 0) return null; return t < 20000000000 ? t * 1000 : t; }
  function normCandles(o){
    o = o || {};
    var arr = Array.isArray(o.candles) ? o.candles : (Array.isArray(o) ? o : []);
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i] || {};
      var t = toMs(c.time != null ? c.time : (c.t != null ? c.t : c.openTime));
      var op = nnum(c.open), hi = nnum(c.high), lo = nnum(c.low), cl = nnum(c.close);
      if (t != null && op != null && hi != null && lo != null && cl != null) {
        out.push({ t:t, o:op, h:hi, l:lo, c:cl });
      }
    }
    out.sort(function(a,b){ return a.t - b.t; });
    return out;
  }

  function applyPayload(d){
    d = d || {};
    if (d.symbol) S.symbol = String(d.symbol).toUpperCase();
    if (d.interval) S.interval = String(d.interval);
    if (d.layout_id) S.layoutId = d.layout_id;
    if (d.id && (d.state || d.drawings_count != null)) S.layoutId = d.id;
    if (d.url) S.url = d.url;
    var st = (d.state && typeof d.state === "object") ? d.state : null;
    if (st) {
      if (Array.isArray(st.drawings)) S.drawings = st.drawings;
      if (st.recommendation !== undefined) S.rec = st.recommendation;
      if (Array.isArray(st.targets)) S.targets = st.targets;
    }
    var cc = null;
    var ohl = d.ohlc;
    /* Some endpoints wrap payloads in {ok, data} — unwrap transparently. */
    if (ohl && ohl.data && typeof ohl.data === "object") ohl = ohl.data;
    var flat = d.data && typeof d.data === "object" ? d.data : d;
    if (ohl) {
      cc = normCandles(ohl);
      if (ohl.source) S.source = ohl.source;
      S.warning = ohl.warning || null;
    } else if (Array.isArray(flat.candles)) {
      cc = normCandles(flat);
      if (flat.source) S.source = flat.source;
      S.warning = flat.warning || null;
    }
    if (cc && cc.length) { S.candles = cc; S.lastUpdate = Date.now(); }
  }

  /* ── rendering ── */
  var UP = "#3FB27F", DOWN = "#E5636B", GOLD = "#E0B15E", INFO = "#7FB4E8",
      MUTED = "#8A93A3", LINE = "#262C36";
  function roleColor(dr){
    if (dr.color && /^#[0-9a-fA-F]{3,8}$/.test(dr.color)) return dr.color;
    var r = String(dr.semanticRole || dr.type || "").toLowerCase();
    if (/support|demand|take_profit|target/.test(r)) return UP;
    if (/resistance|supply|stop/.test(r)) return DOWN;
    if (/entry|fib|forecast/.test(r)) return GOLD;
    return INFO;
  }
  function decimalsFor(span){
    if (span < 0.05) return 5;
    if (span < 5) return 3;
    if (span < 100) return 2;
    return 1;
  }
  function fmtP(p, dec){ return Number(p).toFixed(dec); }

  function draw(){
    var cv = document.getElementById("cv");
    var dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    var cs = S.candles;
    if (!cs.length) return;

    var padL = 6, padR = 56, padT = 10, padB = 20;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var N = Math.min(90, cs.length), i0 = cs.length - N;
    var lo = Infinity, hi = -Infinity;
    for (var i = i0; i < cs.length; i++) { if (cs[i].l < lo) lo = cs[i].l; if (cs[i].h > hi) hi = cs[i].h; }
    var span0 = hi - lo || Math.abs(hi) * 0.001 || 1;
    /* pull recommendation/horizontal levels into range when nearby */
    var extras = [];
    if (S.rec) { extras.push(nnum(S.rec.entry), nnum(S.rec.stop_loss), nnum(S.rec.take_profit)); }
    for (var e2 = 0; e2 < S.targets.length; e2++) extras.push(nnum(S.targets[e2]));
    for (var e3 = 0; e3 < extras.length; e3++) {
      var xv = extras[e3];
      if (xv != null && xv > lo - span0 && xv < hi + span0) { if (xv < lo) lo = xv; if (xv > hi) hi = xv; }
    }
    var span = (hi - lo) || span0; lo -= span * 0.06; hi += span * 0.06; span = hi - lo;
    var dec = decimalsFor(span);
    var step = plotW / N;
    function xFor(i){ var ii = i < i0 ? i0 : i; return padL + (ii - i0 + 0.5) * step; }
    function yFor(p){ return padT + (hi - p) / span * plotH; }
    function idxForTime(t){
      if (t == null) return null;
      for (var k = cs.length - 1; k >= 0; k--) { if (cs[k].t <= t) return k; }
      return 0;
    }
    function ptX(pt){
      if (pt.barsAhead != null && isFinite(pt.barsAhead)) return xFor(cs.length - 1 + Number(pt.barsAhead));
      var t = toMs(pt.time != null ? pt.time : pt.time_offset);
      var ix = idxForTime(t);
      return ix == null ? null : xFor(ix);
    }

    /* grid + price axis */
    g.font = "10px system-ui, sans-serif"; g.textBaseline = "middle";
    for (var gl = 0; gl <= 4; gl++) {
      var gp = lo + span * gl / 4, gy = yFor(gp);
      g.strokeStyle = LINE; g.globalAlpha = 0.55; g.beginPath();
      g.moveTo(padL, gy); g.lineTo(W - padR, gy); g.stroke(); g.globalAlpha = 1;
      g.fillStyle = MUTED; g.textAlign = "left";
      g.fillText(fmtP(gp, dec), W - padR + 5, gy);
    }
    /* time labels */
    g.textAlign = "center"; g.fillStyle = MUTED;
    for (var tl = 0; tl < 3; tl++) {
      var ti = i0 + Math.round((N - 1) * tl / 2);
      var d0 = new Date(cs[ti].t);
      var lbl = ("0" + d0.getHours()).slice(-2) + ":" + ("0" + d0.getMinutes()).slice(-2);
      g.fillText(lbl, xFor(ti), H - padB / 2);
    }

    function hline(p, color, dash, label){
      var y = yFor(p);
      if (y < padT - 4 || y > padT + plotH + 4) return;
      g.strokeStyle = color; g.lineWidth = 1;
      g.setLineDash(dash === "dashed" ? [5,4] : dash === "dotted" ? [2,3] : []);
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.setLineDash([]);
      if (label) {
        g.font = "9px system-ui, sans-serif";
        var tw = g.measureText(label).width + 8;
        g.fillStyle = "#171B22"; g.strokeStyle = color; g.globalAlpha = 0.95;
        g.fillRect(padL + 2, y - 8, tw, 15); g.strokeRect(padL + 2, y - 8, tw, 15);
        g.globalAlpha = 1; g.fillStyle = color; g.textAlign = "left";
        g.fillText(label, padL + 6, y);
        g.font = "10px system-ui, sans-serif";
      }
    }

    /* zones first (behind candles) */
    for (var z = 0; z < S.drawings.length; z++) {
      var dz = S.drawings[z] || {};
      var tz = String(dz.type || "").toLowerCase();
      if (!/zone|range_box|band|risk_reward/.test(tz)) continue;
      var pts = Array.isArray(dz.points) ? dz.points : [];
      var p1 = nnum(pts[0] && pts[0].price != null ? pts[0].price : dz.price);
      var p2 = nnum(pts[1] && pts[1].price != null ? pts[1].price : dz.price2);
      if (p1 == null || p2 == null) continue;
      var zc = roleColor(dz);
      var y1 = yFor(Math.max(p1, p2)), y2 = yFor(Math.min(p1, p2));
      var zx1 = pts[0] ? ptX(pts[0]) : null, zx2 = pts[1] ? ptX(pts[1]) : null;
      var rx = zx1 != null ? Math.min(zx1, zx2 != null ? zx2 : W - padR) : padL;
      var rw = (zx2 != null ? Math.max(zx1 != null ? zx1 : padL, zx2) : W - padR) - rx;
      if (rw < 8) { rx = padL; rw = plotW; }
      g.fillStyle = zc; g.globalAlpha = 0.10; g.fillRect(rx, y1, rw, y2 - y1);
      g.globalAlpha = 0.5; g.strokeStyle = zc; g.strokeRect(rx, y1, rw, y2 - y1);
      g.globalAlpha = 1;
      if (dz.label) { g.fillStyle = zc; g.textAlign = "left"; g.fillText(String(dz.label), rx + 4, y1 + 8); }
    }

    /* candles */
    var cw = Math.max(1.5, step * 0.62);
    for (var ci = i0; ci < cs.length; ci++) {
      var c = cs[ci], x = xFor(ci), up = c.c >= c.o;
      g.strokeStyle = g.fillStyle = up ? UP : DOWN;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, yFor(c.h)); g.lineTo(x, yFor(c.l)); g.stroke();
      var yo = yFor(c.o), ycl = yFor(c.c);
      var top = Math.min(yo, ycl), hgt = Math.max(1, Math.abs(ycl - yo));
      g.fillRect(x - cw / 2, top, cw, hgt);
    }

    /* line/path drawings */
    for (var di = 0; di < S.drawings.length; di++) {
      var dr = S.drawings[di] || {};
      var ty = String(dr.type || "").toLowerCase();
      if (/zone|range_box|band|risk_reward/.test(ty)) continue;
      var col = roleColor(dr);
      var ps = Array.isArray(dr.points) ? dr.points : [];
      var flatP = nnum(dr.price);
      if (/price_line|hline|baseline/.test(ty) || (ps.length <= 1 && flatP != null)) {
        var pv = ps.length && ps[0].price != null ? nnum(ps[0].price) : flatP;
        if (pv != null) hline(pv, col, dr.style || "solid", dr.label ? String(dr.label) : null);
        continue;
      }
      if (/fib/.test(ty)) {
        var f1 = nnum(ps[0] && ps[0].price), f2 = nnum(ps[1] && ps[1].price);
        if (f1 != null && f2 != null) {
          var ratios = [0, 0.236, 0.382, 0.5, 0.618, 1];
          for (var fr = 0; fr < ratios.length; fr++) {
            hline(f1 + (f2 - f1) * ratios[fr], GOLD, fr === 0 || fr === 5 ? "solid" : "dotted",
                  (ratios[fr] * 100).toFixed(1));
          }
        }
        continue;
      }
      /* markers / labels */
      if (/marker|arrow|text|label/.test(ty)) {
        var mp = ps[0];
        if (mp && mp.price != null) {
          var mx = ptX(mp), my = yFor(nnum(mp.price));
          if (mx != null) {
            g.fillStyle = col; g.beginPath(); g.arc(mx, my, 3.5, 0, 7); g.fill();
            if (dr.label) { g.textAlign = "center"; g.fillText(String(dr.label), mx, my - 10); }
          }
        }
        continue;
      }
      /* long/short position boxes via meta */
      if (/position/.test(ty)) {
        var meta = dr.meta || {};
        var en = nnum(meta.entry), sl = nnum(meta.stopLoss), tp = nnum(meta.takeProfit);
        if (en != null) hline(en, GOLD, "dashed", "دخول " + fmtP(en, dec));
        if (sl != null) hline(sl, DOWN, "dashed", "وقف " + fmtP(sl, dec));
        if (tp != null) hline(tp, UP, "dashed", "هدف " + fmtP(tp, dec));
        continue;
      }
      /* default: polyline through points (trend/channel/pattern/forecast) */
      if (ps.length >= 2) {
        g.strokeStyle = col; g.lineWidth = Number(dr.width) >= 1 ? Number(dr.width) : 1.5;
        g.setLineDash(/forecast/.test(ty) || dr.style === "dashed" ? [5,4] : dr.style === "dotted" ? [2,3] : []);
        g.beginPath();
        var started = false;
        for (var pi = 0; pi < ps.length; pi++) {
          var lp = ps[pi];
          if (lp == null || lp.price == null) continue;
          var lx = ptX(lp), ly = yFor(nnum(lp.price));
          if (lx == null) continue;
          if (!started) { g.moveTo(lx, ly); started = true; } else { g.lineTo(lx, ly); }
        }
        if (started) g.stroke();
        g.setLineDash([]); g.lineWidth = 1;
        if (dr.label && ps[0] && ps[0].price != null) {
          var lbx = ptX(ps[0]);
          if (lbx != null) { g.fillStyle = col; g.textAlign = "left"; g.fillText(String(dr.label), lbx + 4, yFor(nnum(ps[0].price)) - 8); }
        }
      }
    }

    /* recommendation levels */
    if (S.rec && typeof S.rec === "object") {
      var re = nnum(S.rec.entry), rs = nnum(S.rec.stop_loss), rt = nnum(S.rec.take_profit);
      if (re != null) hline(re, GOLD, "dashed", "دخول " + fmtP(re, dec));
      if (rs != null) hline(rs, DOWN, "dashed", "وقف " + fmtP(rs, dec));
      if (rt != null) hline(rt, UP, "dashed", "هدف " + fmtP(rt, dec));
      for (var tg = 0; tg < S.targets.length; tg++) {
        var tv = nnum(S.targets[tg]);
        if (tv != null && tv !== rt) hline(tv, UP, "dotted", "هدف " + (tg + 1));
      }
    }

    /* last price tag */
    var last = cs[cs.length - 1];
    var lpY = yFor(last.c);
    g.strokeStyle = last.c >= last.o ? UP : DOWN;
    g.setLineDash([2,3]); g.beginPath(); g.moveTo(padL, lpY); g.lineTo(W - padR, lpY); g.stroke(); g.setLineDash([]);
    g.fillStyle = last.c >= last.o ? UP : DOWN;
    g.fillRect(W - padR + 1, lpY - 8, padR - 3, 16);
    g.fillStyle = "#0B0E13"; g.textAlign = "left"; g.font = "bold 10px system-ui, sans-serif";
    g.fillText(fmtP(last.c, dec), W - padR + 5, lpY);
  }

  /* ── UI glue ── */
  function setTitle(){
    document.getElementById("title").textContent =
      S.symbol ? "الشارت الحي — " + S.symbol + " · " + S.interval : "الشارت الحي";
  }
  function setLevels(){
    var el = document.getElementById("levels");
    if (S.rec && typeof S.rec === "object" && (S.rec.entry != null || S.rec.stop_loss != null)) {
      var act = S.rec.action === "sell" ? "بيع" : S.rec.action === "buy" ? "شراء" : "";
      var parts = [];
      if (act) parts.push("التوصية: " + act);
      if (S.rec.entry != null) parts.push("دخول " + S.rec.entry);
      if (S.rec.stop_loss != null) parts.push("وقف " + S.rec.stop_loss);
      if (S.rec.take_profit != null) parts.push("هدف " + S.rec.take_profit);
      if (S.rec.confidence != null) parts.push("ثقة " + S.rec.confidence + "%");
      el.textContent = parts.join(" · ");
    } else if (S.drawings.length) {
      el.textContent = "رسومات كلود على الشارت: " + S.drawings.length;
    } else {
      el.textContent = "";
    }
  }
  function setStatus(txt, stale){
    var el = document.getElementById("status");
    el.textContent = txt || "";
    el.className = txt ? "status " + (stale ? "stale" : "live") : "status";
  }
  function updateAge(){
    var el = document.getElementById("age");
    if (!S.lastUpdate) { el.textContent = ""; return; }
    var s = Math.round((Date.now() - S.lastUpdate) / 1000);
    el.textContent = "آخر تحديث قبل " + s + " ث";
    el.style.color = s > 20 ? "#D9A441" : "";
  }
  function refresh(){
    setTitle(); setLevels();
    var hint = document.getElementById("hint");
    if (!S.symbol) {
      hint.textContent = "لا يوجد رمز بعد — اطلب من كلود عرض شارت لرمز معين.";
      hint.style.display = "block";
    } else if (!S.candles.length) {
      hint.textContent = S.warning
        ? String(S.warning)
        : "لا شموع متاحة الآن — للرموز الخاصة بالوسيط تأكد أن منصة MetaTrader تعمل.";
      hint.style.display = "block";
    } else {
      hint.style.display = "none";
    }
    draw();
    if (window.AIC) window.AIC.notifySize();
  }

  function schedule(ms){
    clearTimeout(S.timer);
    if (S.paused) return;
    S.timer = setTimeout(tick, ms != null ? ms : (S.failures > 1 ? 10000 : 4000));
  }
  function tick(){
    if (document.hidden || !S.symbol || !window.AIC) { schedule(); return; }
    var args = { symbol: S.symbol, interval: S.interval, limit: 120 };
    if (S.source === "ea" || S.source === "oanda") args.source = S.source;
    var calls = [window.AIC.callTool("get_ohlc", args)];
    if (S.layoutId) calls.push(window.AIC.callTool("get_chart_state", { layout_id: S.layoutId }));
    Promise.all(calls).then(function (res) {
      var got = false;
      if (res[0] && typeof res[0] === "object") { applyPayload({ ohlc: res[0] }); got = true; }
      if (res[1] && typeof res[1] === "object") { applyPayload(res[1]); got = true; }
      S.failures = 0;
      if (got) { setStatus("مباشر", false); refresh(); }
      schedule();
    }).catch(function () {
      S.failures++;
      setStatus("تعذر التحديث — إعادة المحاولة", true);
      schedule();
    });
  }

  window.__aicReady = function (AIC) {
    AIC.onData(function (data) {
      applyPayload(data);
      refresh();
      if (!S.booted) {
        S.booted = true;
        /* draw_on_chart boots without candles — fetch immediately */
        schedule(S.candles.length ? 4000 : 600);
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !S.paused) schedule(300);
    });
    window.addEventListener("resize", draw);
    setInterval(updateAge, 1000);
    document.getElementById("pause").addEventListener("click", function () {
      S.paused = !S.paused;
      this.textContent = S.paused ? "استئناف التحديث" : "إيقاف التحديث";
      if (S.paused) { clearTimeout(S.timer); setStatus("متوقف مؤقتاً", true); }
      else { setStatus("مباشر", false); schedule(300); }
    });
    document.getElementById("open").addEventListener("click", function () {
      var u = S.url
        ? (S.url.indexOf("http") === 0 ? S.url : PLATFORM + S.url)
        : PLATFORM + "/chart" + (S.symbol ? "/" + S.symbol : "");
      AIC.openLink(u);
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
  /* Null = unknown/unavailable — rendered as "—", never a fabricated 0. */
  var DATA = {
    account:{login:null,broker:null,currency:null,balance:null,equity:null,online:false,lastHeartbeat:null},
    todayPnl:null, openTrades:null, trades:[], signals:[], empty:true
  };
  function num(v){ return typeof v==="number"&&isFinite(v) ? v : null; }
  function money(n,d){ if(d==null)d=2; if(n==null||isNaN(n))return "—";
    return (n<0?"\\u2212":"")+"$"+Math.abs(Number(n)).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}); }
  function px(n){ if(n==null||isNaN(n))return "—"; n=Number(n);
    return n>=1000 ? n.toLocaleString("en-US",{maximumFractionDigits:2}) : n.toLocaleString("en-US",{maximumFractionDigits:4}); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }

  /* Accept card-shaped data as-is; defensively map a raw bridge payload.
     Unknown shapes return null — caller keeps the previous state instead of
     rendering fake zeros. */
  function normalize(d){
    if(!d || typeof d!=="object") return null;
    if(d.account && d.trades){ d.empty=false; return d; }
    if(d.forex || d.openTrades || d.recentTrades){
      var ea=(d.forex&&d.forex.ea)||{}, meta=(d.forex&&d.forex.metaapi)||{};
      var open=Array.isArray(d.openTrades)?d.openTrades:null;
      var recent=Array.isArray(d.recentTrades)?d.recentTrades:[];
      var recs=Array.isArray(d.recommendations)?d.recommendations:[];
      return {
        account:{
          login:ea.account_login||meta.account_login||null,
          broker:ea.broker_name||meta.broker_name||null,
          currency:ea.account_currency||meta.account_currency||null,
          balance:num(ea.balance)!=null?num(ea.balance):num(meta.balance),
          equity:num(ea.equity)!=null?num(ea.equity):num(meta.equity),
          online:!!ea.online,
          lastHeartbeat:ea.last_heartbeat_at||null,
          tradeMode:ea.account_trade_mode||meta.account_trade_mode||null
        },
        todayPnl:num(d.todayRealizedPnlUsd),
        openTrades:open?open.length:null,
        trades:recent.map(function(t){return {sym:t.symbol,side:(t.side||"").toLowerCase(),qty:t.qty,price:t.avg_price,pnl:t.pnl,at:(t.created_at||"").slice(11,16)};}),
        signals:recs.map(function(r){var a=(r.action||"").toLowerCase();return {sym:r.symbol,side:a==="sell"?"sell":"buy",entry:r.entry,sl:r.stop_loss,tp:r.take_profit,pat:r.pattern_name||"",blocked:a==="wait"||a==="hold"};}),
        empty:false
      };
    }
    return null;
  }

  function render(){
    var a=DATA.account, T=DATA.trades||[], S=DATA.signals||[];
    var wins=T.filter(function(t){return t.pnl>0;}).length;
    var losses=T.filter(function(t){return t.pnl<=0;}).length;
    var wr=T.length?Math.round(wins/T.length*100):null;
    var pnlChip = DATA.todayPnl==null
      ? '<span class="chip">\\u2014</span>'
      : '<span class="chip '+(DATA.todayPnl>=0?"up":"down")+'">'+(DATA.todayPnl>=0?"\\u25b2":"\\u25bc")+" "+money(DATA.todayPnl)+"</span>";
    var h="";
    h+='<div class="hd"><div class="brand"><b><span class="ai">Ai</span>Chart</b><small>#'+esc(a.login==null?"\\u2014":a.login)+" \\u00b7 "+esc(a.broker==null?"\\u2014":a.broker)+'</small></div><div class="spacer"></div>';
    h+='<span class="pill '+(a.online?"on":"off")+'"><span class="dot"></span>'+(a.online?"\\u0645\\u062a\\u0635\\u0644":"\\u063a\\u064a\\u0631 \\u0645\\u062a\\u0635\\u0644")+"</span>";
    h+='<button class="refresh" id="rf" title="\\u062a\\u062d\\u062f\\u064a\\u062b" aria-label="\\u062a\\u062d\\u062f\\u064a\\u062b"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button></div>';
    h+='<div class="eq"><div class="lbl">\\u0627\\u0644\\u0625\\u064a\\u0643\\u0648\\u064a\\u062a\\u064a</div><div class="big">'+px(a.equity)+(a.currency?'<span class="cur">'+esc(a.currency)+'</span>':"")+'</div>';
    h+='<div class="sub"><span>\\u0627\\u0644\\u0631\\u0635\\u064a\\u062f <b>'+money(a.balance)+'</b></span><span>\\u0631\\u0628\\u062d \\u0627\\u0644\\u064a\\u0648\\u0645 '+pnlChip+"</span></div></div>";
    h+='<div class="tabs" role="tablist"><button class="tab" role="tab" data-tab="ov" aria-selected="true">\\u0646\\u0638\\u0631\\u0629 \\u0639\\u0627\\u0645\\u0629</button>';
    h+='<button class="tab" role="tab" data-tab="tr" aria-selected="false">\\u0627\\u0644\\u0635\\u0641\\u0642\\u0627\\u062a<span class="n">'+T.length+'</span></button>';
    h+='<button class="tab" role="tab" data-tab="sg" aria-selected="false">\\u0627\\u0644\\u062a\\u0648\\u0635\\u064a\\u0627\\u062a<span class="n">'+S.length+"</span></button></div>";
    /* overview */
    h+='<div class="panel" data-panel="ov" data-active><div class="stats">';
    h+='<div class="stat"><div class="k">\\u0635\\u0641\\u0642\\u0627\\u062a \\u0645\\u0641\\u062a\\u0648\\u062d\\u0629</div><div class="v">'+(DATA.openTrades==null?"\\u2014":DATA.openTrades)+"</div></div>";
    if(T.length){
      h+='<div class="stat"><div class="k">\\u0646\\u0633\\u0628\\u0629 \\u0627\\u0644\\u0631\\u0628\\u062d \\u00b7 \\u0622\\u062e\\u0631 '+T.length+'</div><div class="v">'+wr+'<span style="font-size:12px;color:var(--muted)">%</span></div><div class="wl" style="font-size:11px;margin-top:2px"><span class="w">'+wins+' \\u0631\\u0628\\u062d</span><span class="l">'+losses+' \\u062e\\u0633\\u0627\\u0631\\u0629</span></div><div class="barwl"><i style="width:'+wr+'%"></i></div></div>';
    } else {
      h+='<div class="stat"><div class="k">\\u0646\\u0633\\u0628\\u0629 \\u0627\\u0644\\u0631\\u0628\\u062d</div><div class="v">\\u2014</div><div style="color:var(--faint);font-size:10px;margin-top:3px">\\u0644\\u0627 \\u0635\\u0641\\u0642\\u0627\\u062a \\u0628\\u0639\\u062f</div></div>';
    }
    h+='<div class="stat"><div class="k">\\u062d\\u0627\\u0644\\u0629 \\u0627\\u0644\\u062c\\u0633\\u0631 (EA)</div><div class="v" style="font-size:14px;color:'+(a.online?"var(--up)":"var(--down)")+'">'+(a.online?"\\u064a\\u0639\\u0645\\u0644":"\\u0645\\u062a\\u0648\\u0642\\u0641")+'</div><div style="color:var(--faint);font-size:10px;font-family:var(--mono);margin-top:3px">\\u0622\\u062e\\u0631 \\u0646\\u0628\\u0636\\u0629 '+esc(a.lastHeartbeat==null?"\\u2014":a.lastHeartbeat)+"</div></div>";
    h+='<div class="stat"><div class="k">\\u0646\\u0648\\u0639 \\u0627\\u0644\\u062d\\u0633\\u0627\\u0628</div><div class="v" style="font-size:14px">'+(a.tradeMode==="live"?"\\u062d\\u0642\\u064a\\u0642\\u064a":a.tradeMode==="demo"?"\\u062a\\u062c\\u0631\\u064a\\u0628\\u064a":"\\u2014")+(a.currency?" \\u00b7 "+esc(a.currency):"")+'</div><div style="color:var(--faint);font-size:10px;font-family:var(--mono);margin-top:3px">MT5'+(a.broker?" \\u00b7 "+esc(a.broker):"")+"</div></div>";
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
    h+='<div class="foot"><span>get_portfolio</span><span>'+(DATA.empty?"\\u0628\\u0627\\u0646\\u062a\\u0638\\u0627\\u0631 \\u0627\\u0644\\u0628\\u064a\\u0627\\u0646\\u0627\\u062a\\u2026":(a.lastHeartbeat?"\\u0622\\u062e\\u0631 \\u062a\\u062d\\u062f\\u064a\\u062b "+esc(String(a.lastHeartbeat).replace("T"," ").slice(0,16)):"\\u2014"))+"</span></div>";

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
    if(rf) rf.onclick=function(){ rf.disabled=true; AIC.callTool("get_portfolio",{}).then(function(d){ apply(d); }).catch(function(){}).finally(function(){ if(rf) rf.disabled=false; }); };
    if(AIC && AIC.notifySize) setTimeout(AIC.notifySize,60);
  }

  /* Unknown/empty payloads keep the previous state — never fake zeros. */
  function apply(x){
    if(!x) return;
    var n=normalize(x);
    if(n){ DATA=n; }
    render();
  }

  function boot(api){
    var d=api.getData && api.getData();
    if(d){ apply(d); } else { render(); }
    api.onData(apply);
  }
  if(window.AIC){ boot(window.AIC); } else { window.__aicReady=boot; }
})();
`;

/* Self-contained: the host iframe sandbox blocks external assets, so the
 * flagship card inlines its stylesheet, the shared runtime and its script. */
const portfolio = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Lonora — بطاقة الحساب</title>
<style>${PORTFOLIO_CSS}</style>
</head>
<body>
<div class="card" id="card"></div>
<script>${RUNTIME_JS}</script>
<script>${PORTFOLIO_SCRIPT}</script>
</body>
</html>`;

export const PORTFOLIO_ASSETS = {
  css: {
    path: "portfolio-card.css",
    body: PORTFOLIO_CSS,
    mimeType: "text/css; charset=utf-8",
  },
  js: {
    path: "portfolio-card.js",
    body: PORTFOLIO_SCRIPT,
    mimeType: "application/javascript; charset=utf-8",
  },
} as const;

export const WIDGETS: Record<string, string> = {
  "account-overview": accountOverview,
  analysis,
  "recommendation-card": analysis,
  "account-status": accountOverview,
  "pair-picker": genericCard("اختيار زوج", "اختر الزوج المناسب قبل التحليل.", { label: "تحديث الأزواج", tool: "list_instruments" }),
  "risk-status": genericCard("حالة المخاطر", "حدود المخاطر الحالية وإعدادات الحساب."),
  "open-trades": openTradesCard,
  "pending-approvals": genericCard("الموافقات المعلقة", "طلبات التنفيذ التي تنتظر موافقتك.", { label: "تحديث", tool: "get_pending_approvals" }),
  "market-snapshot": analysis,
  "mtf-analysis": analysis,
  "levels-card": analysis,
  "chart-drawn": liveChart,
  "live-chart": liveChart,
  portfolio,
  "trade-readiness": genericCard("جاهزية الصفقة", "فحص ما قبل التنفيذ عبر Lonora."),
  "lessons-card": genericCard("دروس التداول", "ذاكرة الأداء والدروس المشابهة."),
};
