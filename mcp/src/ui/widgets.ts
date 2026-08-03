import { widgetHtml } from "./runtime.js";

const PLATFORM_URL = process.env.AICHART_PUBLIC_URL ?? "https://aichart.lork.cloud";

const accountOverview = widgetHtml(
  "AiChart account overview",
  `<div class="card" id="acct-card">
    <div class="top">
      <div>
        <div class="title" id="acct-title">—</div>
      </div>
      <div class="tag" id="acct-tag">—</div>
    </div>
    <div class="main">
      <div class="label" data-i18n="equity">Equity</div>
      <div class="value" id="equity-val">—</div>
    </div>
    <div class="row">
      <div class="mini"><span data-i18n="balance">Balance</span><strong id="balance-val">—</strong></div>
      <div class="mini"><span data-i18n="openPnl">Open PnL</span><strong id="pnl-val">—</strong></div>
    </div>
    <div class="foot">
      <span id="status" class="status"></span>
    </div>
  </div>`,
  `
  function money(AIC, v) {
    return v == null ? "—" : "$" + AIC.fmt(v, 2);
  }
  function pnlClass(v) {
    if (v == null) return "";
    return Number(v) >= 0 ? "green" : "red";
  }
  window.__aicReady = function (AIC) {
    AIC.applyStaticLabels();
    AIC.onData(function (data) {
      var ac = AIC.parseAccountOverview(data);
      var conn = ac.conn || {};
      document.getElementById("acct-title").textContent = ac.acctTitle || "—";
      var tagEl = document.getElementById("acct-tag");
      tagEl.textContent = ac.tag || "—";
      tagEl.className = "tag" + (conn.stale ? " amber" : String(ac.tag || "").toUpperCase() === "LIVE" ? " green" : "");
      var eqEl = document.getElementById("equity-val");
      eqEl.textContent = money(AIC, ac.equity);
      eqEl.className = "value" + (conn.stale && ac.equity == null ? " amber" : "");
      document.getElementById("balance-val").textContent = money(AIC, ac.balance);
      var pnlEl = document.getElementById("pnl-val");
      if (conn.stale) {
        pnlEl.textContent = "—";
        pnlEl.className = "amber";
      } else if (ac.openPnl != null) {
        pnlEl.textContent = (ac.openPnl >= 0 ? "+" : "") + AIC.fmt(ac.openPnl, 2);
        pnlEl.className = pnlClass(ac.openPnl);
      } else {
        pnlEl.textContent = "—";
        pnlEl.className = "";
      }
      var statusEl = document.getElementById("status");
      if (conn.stale) {
        statusEl.textContent = conn.label;
        statusEl.className = "status stale";
      } else if (conn.label) {
        statusEl.textContent = conn.label;
        statusEl.className = "status live";
      } else {
        statusEl.textContent = "";
        statusEl.className = "status";
      }
      AIC.notifySize();
    });
  };
  `,
);

const analysis = widgetHtml(
  "AiChart analysis",
  `<div class="card" id="analysis-card">
    <div class="top">
      <div><div class="title" id="title">—</div></div>
      <div class="tag wait" id="badge">—</div>
    </div>
    <div class="main" id="main"><div class="skel"></div></div>
    <div class="row">
      <div class="mini"><span data-i18n="price">Price</span><strong id="price-val">—</strong></div>
      <div class="mini"><span data-i18n="trend">Trend</span><strong id="trend-val">—</strong></div>
    </div>
    <div class="foot">
      <span id="status" class="status"></span>
    </div>
  </div>`,
  `
  var current = { symbol: "", interval: "15m", layout_id: null, data_source: "oanda" };
  function oandaSym(s){
    s = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return s.length >= 6 ? s.slice(0, 6) : s;
  }
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
  function trendClass(AIC, v) {
    return AIC.trendInfo(v);
  }
  window.__aicReady = function (AIC) {
    AIC.applyStaticLabels();
    AIC.onData(function (data) {
      data = obj(data);
      var snap = pickSnapshot(data);
      var rec = obj(data.recommendation);
      current.symbol = oandaSym(snap.symbol || rec.symbol || data.symbol || current.symbol);
      current.interval = snap.interval || data.interval || current.interval;
      current.layout_id = data.layout_id || current.layout_id;
      current.data_source = data.data_source || data.dataSource || current.data_source || "oanda";
      var trend = trendClass(AIC, rec.action || snap.trend || data.trend);
      var card = document.getElementById("analysis-card");
      card.className = "card " + trend[0];
      document.getElementById("title").textContent = current.symbol ? current.symbol + " · " + current.interval : "—";
      var badge = document.getElementById("badge");
      badge.className = "tag " + (trend[0] === "buy" ? "green" : trend[0] === "sell" ? "red" : "amber");
      var conf = AIC.num(rec.confidence ?? data.confidence);
      badge.textContent = conf != null ? Math.round(conf) + "%" : (rec.action === "buy" ? AIC.t("buy") : rec.action === "sell" ? AIC.t("sell") : trend[1]);
      var targets = data.targets || (rec.take_profit ? [rec.take_profit] : []);
      /* Price-like fields: 0 is never a real market level — treat as missing. */
      function pxv(v) {
        var n = AIC.num(v);
        return n == null || n === 0 ? null : n;
      }
      /* detect_levels gives supports[]/resistances[] arrays of {price,touches}.
         Pick the level nearest to price on the correct side. */
      function levelPrice(v) { return AIC.num(v && typeof v === "object" ? (v.price != null ? v.price : v.level) : v); }
      function nearest(arr, ref, below) {
        if (!Array.isArray(arr) || !arr.length) return null;
        var best = null, bestD = Infinity;
        for (var i = 0; i < arr.length; i++) {
          var p = levelPrice(arr[i]);
          if (p == null) continue;
          if (ref != null) {
            if (below && p > ref) continue;
            if (!below && p < ref) continue;
          }
          var d = ref != null ? Math.abs(p - ref) : 0;
          if (d < bestD) { bestD = d; best = p; }
        }
        return best != null ? best : levelPrice(arr[0]);
      }
      var refPrice = AIC.num(snap.price ?? snap.close ?? snap.currentPrice);
      var supVal = pxv(snap.support ?? snap.nearestSupport ?? data.support);
      if (supVal == null) supVal = nearest(snap.supports || data.supports, refPrice, true);
      var resVal = pxv(snap.resistance ?? snap.nearestResistance ?? data.resistance);
      if (resVal == null) resVal = nearest(snap.resistances || data.resistances, refPrice, false);
      var priceVal = pxv(snap.price ?? snap.close ?? snap.currentPrice ?? rec.entry);
      var main = document.getElementById("main");
      var signalCls = trend[0] === "buy" ? "green" : trend[0] === "sell" ? "red" : "amber";
      var signalTxt = rec.action === "buy" ? AIC.t("buy") : rec.action === "sell" ? AIC.t("sell") : trend[1];
      var pairs = [];
      if ((snap.rsi14 ?? snap.rsi) != null) pairs.push(["RSI", AIC.fmt(snap.rsi14 ?? snap.rsi, 1), ""]);
      if (fmtMacd(snap.macd) != null) pairs.push(["MACD", AIC.fmt(fmtMacd(snap.macd), 4), ""]);
      if (supVal != null) pairs.push([AIC.t("support"), AIC.fmt(supVal, 5), "green"]);
      if (resVal != null) pairs.push([AIC.t("resistance"), AIC.fmt(resVal, 5), "red"]);
      if (snap.change24hPct != null) {
        pairs.push([AIC.t("change24h"), AIC.fmt(snap.change24hPct, 2) + "%", Number(snap.change24hPct) >= 0 ? "green" : "red"]);
      }
      var h = '<div class="signal ' + signalCls + '">' + signalTxt + '</div>';
      if (conf != null) {
        h += '<div class="confidence"><div class="bar ' + signalCls + '" style="width:' + Math.max(0, Math.min(100, conf)) + '%"></div></div>';
      }
      if (pairs.length) {
        h += pairs.slice(0, 3).map(function (p) {
          return '<div class="pair"><strong>' + p[0] + '</strong><span class="' + p[2] + '">' + p[1] + '</span></div>';
        }).join("");
      } else {
        h += '<div class="sub">' + String(data.reply || snap.summary || rec.rationale || data.summary || "").slice(0, 120) + '</div>';
      }
      main.innerHTML = h;
      document.getElementById("price-val").textContent = priceVal != null ? AIC.fmt(priceVal, 5) : "—";
      document.getElementById("price-val").className = priceVal != null ? "blue" : "";
      document.getElementById("trend-val").textContent = trend[1];
      document.getElementById("trend-val").className = signalCls;
      var statusEl = document.getElementById("status");
      var stale = AIC.bridgeLinkState(data).stale;
      statusEl.textContent = stale ? AIC.bridgeLinkState(data).label : "";
      statusEl.className = stale ? "status stale" : "status";
      AIC.notifySize();
    });
  };
  `,
);

function genericCard(titleKey: string, _subtitleKey: string) {
  return widgetHtml(
    `AiChart ${titleKey}`,
    `<div class="card">
      <div class="top">
        <div><div class="title" data-i18n="${titleKey}"></div></div>
      </div>
      <div class="main" id="body"><div class="skel"></div></div>
      <div class="foot">
        <span id="status" class="status"></span>
      </div>
    </div>`,
    `
    function obj(v) { return v && typeof v === "object" ? v : {}; }
    function unwrap(data) {
      if (Array.isArray(data)) return { items: data };
      data = obj(data);
      var inner = data.data || data.payload || data.result;
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        var merged = {};
        for (var ik in inner) merged[ik] = inner[ik];
        for (var dk in data) if (dk !== "data" && dk !== "payload" && dk !== "result" && merged[dk] == null) merged[dk] = data[dk];
        return merged;
      }
      return data;
    }
    function rowsFrom(data, AIC) {
      var out = [];
      data = unwrap(data);
      function add(label, value, digits) {
        if (out.length >= 6) return;
        var val = AIC.cell(value, digits == null ? 4 : digits);
        if (val) out.push([label, val]);
      }
      var trades = AIC.pickTrades(data);
      if (trades.length) add(AIC.t("trades"), String(trades.length));
      if (Array.isArray(data.items)) add(AIC.t("items"), String(data.items.length));
      if (Array.isArray(data.candidates)) add(AIC.t("candidates"), String(data.candidates.length));
      if (Array.isArray(data.pending) || Array.isArray(data.approvals)) add(AIC.t("pending"), String((data.pending || data.approvals).length));
      add(AIC.t("status"), data.status || data.mode || data.ready);
      add(AIC.t("todayPnl"), data.todayRealizedPnlUsd || data.today_pnl || data.pnl, 2);
      for (var k in data) {
        if (k === "trades" || k === "openTrades" || k === "open_trades" || k === "capital" ||
            k === "items" || k === "candidates" || k === "pending" || k === "approvals") continue;
        var v = data[k];
        if (v == null) continue;
        if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") add(k, v);
        if (Array.isArray(v)) add(k, String(v.length));
        if (out.length >= 6) break;
      }
      return out;
    }
    window.__aicReady = function (AIC) {
      AIC.applyStaticLabels();
      AIC.onData(function (data) {
        data = unwrap(data);
        var body = document.getElementById("body");
        var rows = rowsFrom(data, AIC);
        if (!rows.length) {
          body.innerHTML = '<div class="empty">' + AIC.t("noData") + '</div>';
        } else {
          body.innerHTML = rows.slice(0, 4).map(function (row) {
            var val = AIC.cell(row[1], 4);
            return val ? '<div class="pair"><strong>' + row[0] + '</strong><span>' + val + '</span></div>' : '';
          }).join("") || '<div class="empty">' + AIC.t("noData") + '</div>';
        }
        var stale = AIC.bridgeLinkState(data).stale;
        var statusEl = document.getElementById("status");
        statusEl.textContent = stale ? AIC.bridgeLinkState(data).label : "";
        statusEl.className = stale ? "status stale" : "status";
        AIC.notifySize();
      });
    };
    `,
  );
}

const openTradesCard = widgetHtml(
  "AiChart open trades",
  `<div class="card">
    <div class="top">
      <div><div class="title" id="trades-title">—</div></div>
      <div class="tag" id="count-tag">—</div>
    </div>
    <div class="main" id="trades"><div class="skel"></div></div>
    <div class="row">
      <div class="mini"><span data-i18n="totalPnl">Total PnL</span><strong id="total-pnl">—</strong></div>
      <div class="mini"><span data-i18n="connection">Connection</span><strong id="conn-status">—</strong></div>
    </div>
    <div class="foot">
      <span id="status" class="status"></span>
    </div>
  </div>`,
  `
  window.__aicReady = function (AIC) {
    AIC.applyStaticLabels();
    function sumPnl(trades) {
      var sum = 0, seen = false;
      for (var i = 0; i < trades.length; i++) {
        var t = trades[i] || {};
        var p = AIC.num(t.profit != null ? t.profit : (t.pnl != null ? t.pnl : t.open_pnl));
        if (p != null) { sum += p; seen = true; }
      }
      return seen ? sum : null;
    }
    function render(data) {
      data = data || {};
      var stale = AIC.bridgeLinkState(data).stale;
      var trades = AIC.pickTrades(data);
      var box = document.getElementById("trades");
      document.getElementById("count-tag").textContent = String(trades.length);
      if (stale && !trades.length) {
        box.innerHTML = '<div class="empty">' + AIC.t("bridgeNoTrades") + '</div>';
      } else {
        AIC.renderTradeLines(box, trades, AIC.fmt.bind(AIC));
      }
      var pnl = sumPnl(trades);
      var pnlEl = document.getElementById("total-pnl");
      if (stale) {
        pnlEl.textContent = "—";
        pnlEl.className = "amber";
      } else if (pnl != null) {
        pnlEl.textContent = (pnl >= 0 ? "+" : "") + AIC.fmt(pnl, 2);
        pnlEl.className = pnl >= 0 ? "green" : "red";
      } else {
        pnlEl.textContent = "—";
        pnlEl.className = "";
      }
      var connEl = document.getElementById("conn-status");
      connEl.textContent = stale ? AIC.t("connStale") : AIC.t("connLive");
      connEl.className = stale ? "amber" : "green";
      var statusEl = document.getElementById("status");
      statusEl.textContent = stale ? AIC.bridgeLinkState(data).label : "";
      statusEl.className = stale ? "status stale" : "status";
      AIC.notifySize();
    }
    AIC.onData(render);
  };
  `,
);

/* ────────────────────────────── live chart ──────────────────────────────
 * Canvas mini-chart: candles from get_ohlc + Claude's drawings/recommendation
 * from get_chart_state, refreshed every ~4s via host-mediated callTool.
 * Read-only — no toolbars; one button opens the full TradingView chart. */
const liveChart = widgetHtml(
  "AiChart live chart",
  `<div class="card">
    <div class="top">
      <div>
        <div class="title" id="title">—</div>
      </div>
      <div class="tag green" id="live-tag">LIVE</div>
    </div>
    <div class="main">
      <div class="chart-wrap">
        <canvas id="cv"></canvas>
        <div id="hint" class="empty" style="display:none;position:absolute;inset:0;margin:auto;height:fit-content" data-i18n="noSymbol">No symbol yet</div>
      </div>
    </div>
    <div class="row">
      <div class="mini"><span data-i18n="price">Price</span><strong id="price-lbl" class="green">—</strong></div>
      <div class="mini"><span data-i18n="trend">Trend</span><strong id="trend-lbl">—</strong></div>
    </div>
    <div class="foot">
      <span id="status" class="status"></span>
    </div>
  </div>`,
  `
  var PLATFORM = "${PLATFORM_URL}";
  var S = { symbol:null, interval:"15m", layoutId:null, url:null, candles:[],
            drawings:[], rec:null, targets:[], lastUpdate:0, paused:false,
            failures:0, timer:null, booted:false, source:"oanda", warning:null };

  /* Broker tickers (XAUUSDM, EURUSDm) → OANDA 6-letter key for candle fetch. */
  function oandaSym(s){
    s = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return s.length >= 6 ? s.slice(0, 6) : s;
  }

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
    if (d.symbol) S.symbol = oandaSym(d.symbol);
    if (d.interval) S.interval = String(d.interval);
    if (d.layout_id) S.layoutId = d.layout_id;
    if (d.id && (d.state || d.drawings_count != null)) S.layoutId = d.id;
    if (d.url) S.url = d.url;
    if (d.data_source === "oanda" || d.dataSource === "oanda") S.source = "oanda";
    else if (!S.source) S.source = "oanda";
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
      S.source = ohl.source === "metaapi" ? "metaapi" : "oanda";
      S.warning = ohl.warning || null;
    } else if (Array.isArray(flat.candles)) {
      cc = normCandles(flat);
      S.source = flat.source === "metaapi" ? "metaapi" : "oanda";
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
  function chartLbl(key, val) {
    return (window.AIC && window.AIC.t ? window.AIC.t(key) : key) + " " + val;
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
        if (en != null) hline(en, GOLD, "dashed", chartLbl("entry", fmtP(en, dec)));
        if (sl != null) hline(sl, DOWN, "dashed", chartLbl("stop", fmtP(sl, dec)));
        if (tp != null) hline(tp, UP, "dashed", chartLbl("target", fmtP(tp, dec)));
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
      if (re != null) hline(re, GOLD, "dashed", chartLbl("entry", fmtP(re, dec)));
      if (rs != null) hline(rs, DOWN, "dashed", chartLbl("stop", fmtP(rs, dec)));
      if (rt != null) hline(rt, UP, "dashed", chartLbl("target", fmtP(rt, dec)));
      for (var tg = 0; tg < S.targets.length; tg++) {
        var tv = nnum(S.targets[tg]);
        if (tv != null && tv !== rt) hline(tv, UP, "dotted", chartLbl("target", String(tg + 1)));
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
    var fallback = window.AIC && window.AIC.t ? window.AIC.t("chartTitle") : "Chart";
    document.getElementById("title").textContent = S.symbol ? S.symbol + " · " + S.interval : fallback;
  }
  function setLevels(){
    var priceEl = document.getElementById("price-lbl");
    var trendEl = document.getElementById("trend-lbl");
    var last = S.candles.length ? S.candles[S.candles.length - 1] : null;
    if (last) {
      var lo = last.l, hi = last.h;
      for (var ci = 0; ci < S.candles.length; ci++) {
        lo = Math.min(lo, S.candles[ci].l);
        hi = Math.max(hi, S.candles[ci].h);
      }
      var dec = decimalsFor(hi - lo);
      priceEl.textContent = fmtP(last.c, dec);
      priceEl.className = last.c >= last.o ? "green" : "red";
      var up = S.candles.length > 1 && last.c >= S.candles[S.candles.length - 2].c;
      trendEl.textContent = window.AIC && window.AIC.t ? (up ? window.AIC.t("bullish") : window.AIC.t("bearish")) : (up ? "Up" : "Down");
      trendEl.className = up ? "green" : "red";
    } else {
      priceEl.textContent = "—";
      priceEl.className = "";
      trendEl.textContent = "—";
      trendEl.className = "";
    }
    var tag = document.getElementById("live-tag");
    tag.textContent = S.paused ? "PAUSE" : "LIVE";
    tag.className = "tag " + (S.paused ? "amber" : "green");
  }
  function setStatus(txt, stale){
    var el = document.getElementById("status");
    if (!stale) { el.textContent = ""; el.className = "status"; return; }
    el.textContent = txt || "";
    el.className = txt ? "status stale" : "status";
  }
  function refresh(){
    setTitle(); setLevels();
    var hint = document.getElementById("hint");
    if (!S.symbol) {
      hint.textContent = window.AIC && window.AIC.t ? window.AIC.t("noSymbolHint") : "No symbol yet";
      hint.style.display = "block";
    } else if (!S.candles.length) {
      hint.textContent = S.warning
        ? String(S.warning)
        : (window.AIC && window.AIC.t ? window.AIC.t("noCandles") : "No candles available");
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
    var args = { symbol: oandaSym(S.symbol), interval: S.interval, limit: 120, source: "oanda" };
    var calls = [window.AIC.callTool("get_ohlc", args)];
    if (S.layoutId) calls.push(window.AIC.callTool("get_chart_state", { layout_id: S.layoutId }));
    Promise.all(calls).then(function (res) {
      var got = false;
      if (res[0] && typeof res[0] === "object") { applyPayload({ ohlc: res[0] }); got = true; }
      if (res[1] && typeof res[1] === "object") { applyPayload(res[1]); got = true; }
      S.failures = 0;
      if (got) { setStatus("", false); refresh(); }
      schedule();
    }).catch(function () {
      S.failures++;
      setStatus(window.AIC && window.AIC.t ? window.AIC.t("updateFailed") : "Update failed", true);
      schedule();
    });
  }

  window.__aicReady = function (AIC) {
    AIC.applyStaticLabels();
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
  };
  `,
);

/* ─────────────────────────── recommendation ───────────────────────────
 * Dedicated trade-idea card: action badge + confidence, entry/stop/target
 * ladder with computed R:R, rationale, factor chips. Also renders scan_market
 * multi-opportunity payloads as a ranked list. Reads the recommendation from
 * many shapes (create_recommendation, run_market_analysis, scan_market). */
const recommendationCard = widgetHtml(
  "AiChart recommendation",
  `<div class="card wait" id="rec-card">
    <div class="top">
      <div>
        <div class="title" id="title">—</div>
      </div>
      <div class="tag amber" id="badge">—</div>
    </div>
    <div class="main" id="body"><div class="skel"></div></div>
    <div class="row">
      <div class="mini"><span data-i18n="stopLoss">Stop loss</span><strong id="sl-val" class="red">—</strong></div>
      <div class="mini"><span data-i18n="targetLabel">Target</span><strong id="tp-val" class="green">—</strong></div>
    </div>
    <div class="foot">
      <span id="status" class="status"></span>
    </div>
  </div>`,
  `
  var PLATFORM = "${PLATFORM_URL}";
  var current = { symbol:"", interval:"1h", chartUrl:null };
  function obj(v){ return v && typeof v === "object" ? v : {}; }
  function pickRec(data){
    if (data.recommendation) return obj(data.recommendation);
    if (data.action || data.side) return data;
    var lists = [data.opportunities, data.results, data.candidates, data.picks, data.scan, data.top];
    for (var i=0;i<lists.length;i++){ if (Array.isArray(lists[i]) && lists[i].length) return obj(lists[i][0]); }
    if (data.best || data.pick) return obj(data.best || data.pick);
    return {};
  }
  function pickList(data){
    var lists = [data.opportunities, data.results, data.candidates, data.picks, data.scan];
    for (var i=0;i<lists.length;i++){ if (Array.isArray(lists[i]) && lists[i].length > 1) return lists[i]; }
    return null;
  }
  function actInfo(AIC, a){
    return AIC.actInfo(a);
  }
  function first(){
    for (var i=0;i<arguments.length;i++){
      var v = arguments[i];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  }
  function unwrapPayload(data){
    data = obj(data);
    var inner = data.data || data.payload || data.result;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      var merged = {};
      for (var ik in inner) merged[ik] = inner[ik];
      for (var dk in data) if (dk !== "data" && dk !== "payload" && dk !== "result" && merged[dk] == null) merged[dk] = data[dk];
      return merged;
    }
    return data;
  }
  function listFrom(data){
    data = unwrapPayload(data);
    var lists = [
      data.opportunities, data.results, data.candidates, data.picks,
      data.scan, data.top, data.recommendations
    ];
    if (Array.isArray(data.recommendation)) lists.push(data.recommendation);
    for (var i=0;i<lists.length;i++){
      if (Array.isArray(lists[i]) && lists[i].length) return lists[i];
    }
    return null;
  }
  pickList = listFrom;
  pickRec = function(data){
    data = unwrapPayload(data);
    if (data.recommendation && !Array.isArray(data.recommendation)) return obj(data.recommendation);
    if (data.best || data.pick || data.selected) return obj(data.best || data.pick || data.selected);
    if (data.action || data.side || data.decision || data.direction || data.signal || data.entry || data.stop_loss || data.take_profit) return data;
    var list = listFrom(data);
    return list ? obj(list[0]) : {};
  };
  window.__aicReady = function (AIC){
    AIC.applyStaticLabels();
    AIC.onData(function (data){
      data = unwrapPayload(data);
      var rec = pickRec(data);
      var act = actInfo(AIC, first(rec.action, rec.side, rec.decision, rec.direction, rec.signal, rec.type, rec.score != null ? "candidate" : null));
      current.symbol = first(rec.symbol, rec.sym, data.symbol, data.baseSymbol, current.symbol);
      current.interval = first(rec.timeframe, rec.interval, data.timeframe, data.interval, current.interval, "1h");
      current.chartUrl = first(data.chart_url, data.chart_url_public, data.chart_url_telegram, data.chart_image_url, rec.chart_url, rec.chart_image_url, current.chartUrl);
      var tf = current.interval || "1h";
      document.getElementById("title").textContent = current.symbol ? current.symbol + " · " + tf : "—";
      var card = document.getElementById("rec-card");
      card.className = "card " + act.cls;
      var badge = document.getElementById("badge");
      var conf = AIC.num(first(rec.confidence, rec.score, rec.probability, data.confidence, data.score));
      badge.className = "tag " + (act.cls === "buy" ? "green" : act.cls === "sell" ? "red" : "amber");
      badge.textContent = conf != null ? Math.round(conf) + "%" : act.label;
      var entry = AIC.num(first(rec.entry, rec.open, rec.price, rec.currentPrice));
      var sl = AIC.num(first(rec.stop_loss, rec.stopLoss, rec.stop, rec.sl));
      var tp = AIC.num(first(rec.take_profit, rec.takeProfit, rec.target, rec.tp, Array.isArray(rec.targets)?rec.targets[0]:null, Array.isArray(data.targets)?data.targets[0]:null));
      var body = document.getElementById("body");
      var list = pickList(data);
      if (list) {
        var h = "";
        for (var i=0;i<Math.min(list.length,4);i++){
          var o = obj(list[i]); var oa = actInfo(AIC, first(o.action, o.side, o.decision, o.direction, o.signal, o.type, "candidate"));
          var oc = AIC.num(first(o.confidence, o.score, o.probability));
          var note = oc != null ? Math.round(oc)+"%" : (AIC.cell(first(o.summary, o.reason, o.rationale, o.price), 5) || "");
          h += '<div class="pair"><strong>'+(o.symbol||o.sym||"—")+'</strong><span class="'+
            (oa.cls==="buy"?"green":oa.cls==="sell"?"red":"amber")+'">'+
            oa.label+(note ? " "+note : "")+'</span></div>';
        }
        body.innerHTML = h || '<div class="empty">'+AIC.t("noOpportunities")+'</div>';
        document.getElementById("sl-val").textContent = "—";
        document.getElementById("tp-val").textContent = "—";
      } else if (entry!=null || sl!=null || tp!=null || act.dir !== 0) {
        var sigCls = act.cls==="buy"?"green":act.cls==="sell"?"red":"amber";
        var details = [];
        if (entry != null) details.push([AIC.t("entryLabel"), AIC.fmt(entry, 5), "blue"]);
        if (rec.risk_reward != null || rec.rr != null) details.push(["R:R", AIC.cell(first(rec.risk_reward, rec.rr), 2), ""]);
        if (rec.pattern_name || rec.pattern) details.push([AIC.t("pattern"), String(first(rec.pattern_name, rec.pattern)), ""]);
        if (Array.isArray(rec.factors) && rec.factors.length) details.push([AIC.t("factors"), rec.factors.slice(0,2).join(" · "), ""]);
        var h2 = '<div class="signal '+sigCls+'">'+act.label+'</div>';
        if (conf!=null) {
          h2 += '<div class="confidence"><div class="bar '+sigCls+'" style="width:'+Math.max(0,Math.min(100,conf))+'%"></div></div>';
        }
        if (details.length) {
          h2 += details.slice(0,3).map(function (p) {
            return '<div class="pair"><strong>'+p[0]+'</strong><span class="'+p[2]+'">'+p[1]+'</span></div>';
          }).join("");
        } else if (rec.rationale || data.summary || data.reply) {
          h2 += '<div class="sub">'+String(first(rec.rationale, data.summary, data.reply)).slice(0,140)+'</div>';
        }
        body.innerHTML = h2;
        document.getElementById("sl-val").textContent = sl != null ? AIC.fmt(sl, 5) : "—";
        document.getElementById("tp-val").textContent = tp != null ? AIC.fmt(tp, 5) : "—";
      } else {
        body.innerHTML = '<div class="empty">'+AIC.t("noRecommendation")+'</div>';
        document.getElementById("sl-val").textContent = "—";
        document.getElementById("tp-val").textContent = "—";
      }
      var stale = AIC.bridgeLinkState(data).stale;
      var statusEl = document.getElementById("status");
      statusEl.textContent = stale ? AIC.bridgeLinkState(data).label : "";
      statusEl.className = stale ? "status stale" : "status";
      AIC.notifySize();
    });
  };
  `,
);

/* ─────────────────────────── approval decision card ───────────────────────────
 * The one card in the catalog allowed to own buttons — it is an APPROVAL
 * surface, never an execution surface: the only tool its buttons ever call is
 * respond_approval, which itself still runs every server-side check
 * (revalidation, technical execution safety) before anything reaches the
 * broker. Renders 3 states from one shape:
 *  - "actionable": intent.status === "pending" and not a preview → Approve/Reject.
 *  - "preview": dry_run === true (request_approval or respond_approval preview)
 *    → PREVIEW badge, no buttons (nothing exists yet to act on, or this is
 *    only a look-before-you-leap check).
 *  - "resolved": respond_approval's real response (top-level status/ok/reason)
 *    → outcome banner, no buttons.
 * No "modify" button: no tool in this catalog can alter a pending intent's
 * terms — only reject and re-propose (in chat), which is not a card action. */
const approvalCard = widgetHtml(
  "AiChart approval",
  `<div class="card wait" id="appr-card">
    <div class="top">
      <div><div class="title" id="appr-title">—</div></div>
      <div class="tag amber" id="appr-badge">—</div>
    </div>
    <div class="main" id="appr-body"><div class="skel"></div></div>
    <div class="row">
      <div class="mini"><span data-i18n="stopLoss">Stop loss</span><strong id="appr-sl" class="red">—</strong></div>
      <div class="mini"><span data-i18n="targetLabel">Target</span><strong id="appr-tp" class="green">—</strong></div>
    </div>
    <div class="banner" id="appr-banner" style="display:none"></div>
    <div class="actions" id="appr-actions" style="display:none">
      <button type="button" id="appr-approve" class="tag green">✓ <span data-i18n="approve">Approve</span></button>
      <button type="button" id="appr-reject" class="tag red">✕ <span data-i18n="reject">Reject</span></button>
    </div>
    <div class="foot">
      <span id="appr-status" class="status"></span>
    </div>
  </div>`,
  `
  function obj(v){ return v && typeof v === "object" ? v : {}; }
  function first(){ for (var i=0;i<arguments.length;i++){ var v=arguments[i]; if (v!==undefined&&v!==null&&v!=="") return v; } return null; }
  var state = { intentId: null, busy: false };
  function titleCase(s){ s = String(s||""); return s ? s.charAt(0).toUpperCase()+s.slice(1).replace(/_/g," ") : ""; }
  window.__aicReady = function (AIC){
    AIC.applyStaticLabels();
    var approveBtn = document.getElementById("appr-approve");
    var rejectBtn = document.getElementById("appr-reject");
    function setBusy(b){
      state.busy = b;
      approveBtn.disabled = b;
      rejectBtn.disabled = b;
    }
    function render(data){
      data = obj(data);
      var preview = data.dry_run === true;
      var intent = obj(data.intent || data.would_send);
      var act = AIC.actInfo(intent.side);
      var card = document.getElementById("appr-card");
      card.className = "card " + act.cls;
      var sym = intent.symbol || "—";
      document.getElementById("appr-title").textContent = intent.side ? sym + " · " + act.label : sym;
      var badge = document.getElementById("appr-badge");
      var resolvedStatus = !preview && data.status ? String(data.status) : null;
      badge.textContent = preview ? AIC.t("previewBadge") : (resolvedStatus ? titleCase(resolvedStatus) : (intent.status ? titleCase(intent.status) : "—"));
      badge.className = "tag " + (preview ? "amber" : (data.ok === true ? "green" : data.ok === false ? "red" : "amber"));
      var entry = AIC.num(intent.entry);
      var sl = AIC.num(intent.stop_loss);
      var tp = AIC.num(intent.take_profit);
      var body = document.getElementById("appr-body");
      var lines = [];
      if (entry != null) lines.push([AIC.t("entryLabel"), AIC.fmt(entry, 5), "blue"]);
      if (intent.notional != null) lines.push(["Risk", AIC.cell(intent.notional, 2), ""]);
      if (intent.broker) lines.push(["Broker", String(intent.broker), ""]);
      var h = "";
      if (lines.length) {
        h = lines.map(function (p) {
          return '<div class="pair"><strong>'+p[0]+'</strong><span class="'+p[2]+'">'+p[1]+'</span></div>';
        }).join("");
      }
      if (intent.rationale) h += '<div class="sub">' + String(intent.rationale).slice(0, 160) + '</div>';
      body.innerHTML = h || '<div class="empty">' + AIC.t("noRecommendation") + '</div>';
      document.getElementById("appr-sl").textContent = sl != null ? AIC.fmt(sl, 5) : "—";
      document.getElementById("appr-tp").textContent = tp != null ? AIC.fmt(tp, 5) : "—";

      var banner = document.getElementById("appr-banner");
      var actions = document.getElementById("appr-actions");
      var actionable = !preview && intent.id != null && intent.status === "pending" && !resolvedStatus;
      if (actionable) {
        actions.style.display = "flex";
        banner.style.display = "none";
        state.intentId = intent.id;
      } else {
        actions.style.display = "none";
        state.intentId = null;
        if (resolvedStatus) {
          banner.style.display = "block";
          var cls = data.ok === true ? "ok" : (resolvedStatus === "rejected" ? "warn" : "bad");
          banner.className = "banner " + cls;
          banner.textContent = titleCase(resolvedStatus) + (data.reason ? " — " + data.reason : "") +
            (data.tradeId != null ? " (trade #" + data.tradeId + ")" : "");
        } else if (preview) {
          banner.style.display = "block";
          banner.className = "banner warn";
          banner.textContent = AIC.t("previewBadge") +
            (data.note ? " — " + data.note : "") +
            (data.blocking_reason ? " — " + data.blocking_reason : "") +
            (data.reason ? " — " + data.reason : "");
        } else {
          banner.style.display = "none";
        }
      }
      var statusEl = document.getElementById("appr-status");
      var stale = AIC.bridgeLinkState(data).stale;
      statusEl.textContent = stale ? AIC.bridgeLinkState(data).label : "";
      statusEl.className = stale ? "status stale" : "status";
      AIC.notifySize();
    }
    function act(action){
      if (state.busy || state.intentId == null) return;
      setBusy(true);
      var statusEl = document.getElementById("appr-status");
      statusEl.textContent = AIC.t("sending");
      statusEl.className = "status";
      AIC.callTool("respond_approval", { intent_id: state.intentId, action: action }).catch(function () {
        setBusy(false);
        statusEl.textContent = AIC.t("actionFailed");
        statusEl.className = "status stale";
      });
    }
    approveBtn.addEventListener("click", function () { act("approve"); });
    rejectBtn.addEventListener("click", function () { act("reject"); });
    AIC.onData(function (data) { setBusy(false); render(data); });
  };
  `,
);

/* ─────────────────────────── approval queue (row-action table) ───────────────────────────
 * get_pending_approvals: aggregate count on top, each pending intent as its
 * own row with inline Approve/Reject — same respond_approval call as the
 * decision card, just triggered per-row instead of for a single intent. */
const approvalQueue = widgetHtml(
  "AiChart pending approvals",
  `<div class="card wait" id="queue-card">
    <div class="top">
      <div><div class="title" data-i18n="pendingApprovalsTitle">Pending approvals</div></div>
      <div class="tag amber" id="queue-count">—</div>
    </div>
    <div class="main" id="queue-body"><div class="skel"></div></div>
    <div class="foot">
      <span id="queue-status" class="status"></span>
    </div>
  </div>`,
  `
  function obj(v){ return v && typeof v === "object" ? v : {}; }
  var busyIds = {};
  window.__aicReady = function (AIC){
    AIC.applyStaticLabels();
    function actInfoOf(intent){ return AIC.actInfo(intent.side); }
    function rowHtml(intent){
      var act = actInfoOf(intent);
      var busy = !!busyIds[intent.id];
      var bits = [];
      if (AIC.num(intent.entry) != null) bits.push(AIC.t("entryLabel") + " " + AIC.fmt(intent.entry, 5));
      if (AIC.num(intent.stop_loss) != null) bits.push(AIC.t("stop") + " " + AIC.fmt(intent.stop_loss, 5));
      if (AIC.num(intent.take_profit) != null) bits.push(AIC.t("target") + " " + AIC.fmt(intent.take_profit, 5));
      return '<div class="qrow" data-id="' + intent.id + '">' +
        '<div class="qtop"><strong>' + (intent.symbol || "—") + ' · ' + act.label + '</strong>' +
        '<span class="qactions">' +
          '<button type="button" class="tag green qa" data-action="approve" data-id="' + intent.id + '" ' + (busy ? "disabled" : "") + '>✓</button>' +
          '<button type="button" class="tag red qa" data-action="reject" data-id="' + intent.id + '" ' + (busy ? "disabled" : "") + '>✕</button>' +
        '</span></div>' +
        (bits.length ? '<span class="sub">' + bits.join(" · ") + '</span>' : "") +
        '</div>';
    }
    function render(data){
      data = obj(data);
      var pending = Array.isArray(data.pending) ? data.pending : [];
      document.getElementById("queue-count").textContent = String(pending.length);
      var body = document.getElementById("queue-body");
      body.innerHTML = pending.length
        ? pending.slice(0, 8).map(rowHtml).join("")
        : '<div class="empty">' + AIC.t("noPending") + '</div>';
      var statusEl = document.getElementById("queue-status");
      var stale = AIC.bridgeLinkState(data).stale;
      statusEl.textContent = stale ? AIC.bridgeLinkState(data).label : "";
      statusEl.className = stale ? "status stale" : "status";
      AIC.notifySize();
    }
    document.getElementById("queue-body").addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest(".qa") : null;
      if (!btn || btn.disabled) return;
      var id = Number(btn.getAttribute("data-id"));
      var action = btn.getAttribute("data-action");
      if (!id || busyIds[id]) return;
      busyIds[id] = true;
      btn.disabled = true;
      var sibling = btn.parentNode.querySelector('.qa[data-action="' + (action === "approve" ? "reject" : "approve") + '"]');
      if (sibling) sibling.disabled = true;
      var statusEl = document.getElementById("queue-status");
      statusEl.textContent = AIC.t("sending");
      statusEl.className = "status";
      // respond_approval's OWN result is single-intent shaped, not the list
      // this widget renders — chaining a get_pending_approvals refetch after
      // it is what puts the shared "latest" payload back into {pending:[...]}
      // shape before the automatic onData re-render fires, otherwise a
      // one-row action would blank out every other still-pending row.
      AIC.callTool("respond_approval", { intent_id: id, action: action })
        .then(function () { return AIC.callTool("get_pending_approvals", {}); })
        .then(function () {
        delete busyIds[id];
      }).catch(function () {
        delete busyIds[id];
        btn.disabled = false;
        if (sibling) sibling.disabled = false;
        statusEl.textContent = AIC.t("actionFailed");
        statusEl.className = "status stale";
      });
    });
    AIC.onData(render);
  };
  `,
);

/* ─────────────────────────── scan results (report) ───────────────────────────
 * scan_market compares MULTIPLE symbols and returns a code-only opportunity
 * SCORE per candidate — it computes no direction (no buy/sell field exists
 * anywhere in its response; scanForexSymbol only tallies mixed bullish AND
 * bearish signal strength into one magnitude). The old recommendation-card
 * reuse rendered every row with a fabricated "Wait" badge (its action-lookup
 * found no direction field and fell through to that default) — evidence
 * dressed as a verdict. This card shows exactly what the tool computed:
 * ranked by score, with the actual signal strings that produced it, and
 * nothing colored buy/sell. Directional judgment is the model's, made from
 * real analysis of the winning candidate — never this list. */
const scanResults = widgetHtml(
  "AiChart scan results",
  `<div class="card" id="scan-card">
    <div class="top">
      <div><div class="title" id="scan-title">—</div></div>
      <div class="tag" id="scan-count">—</div>
    </div>
    <div class="main" id="scan-body"><div class="skel"></div></div>
    <div class="foot">
      <span id="scan-status" class="status"></span>
    </div>
  </div>`,
  `
  function obj(v){ return v && typeof v === "object" ? v : {}; }
  window.__aicReady = function (AIC){
    AIC.applyStaticLabels();
    AIC.onData(function (data){
      data = obj(data);
      var candidates = Array.isArray(data.candidates) ? data.candidates.slice() : [];
      candidates.sort(function (a, b) { return (AIC.num(b.score) || 0) - (AIC.num(a.score) || 0); });
      document.getElementById("scan-title").textContent = Array.isArray(data.scanned) ? (data.scanned.length + " scanned") : "Scan";
      document.getElementById("scan-count").textContent = String(candidates.length);
      var body = document.getElementById("scan-body");
      if (!candidates.length) {
        body.innerHTML = '<div class="empty">' + AIC.t("noOpportunities") + '</div>';
      } else {
        body.innerHTML = candidates.slice(0, 6).map(function (c) {
          var score = AIC.num(c.score);
          var top = Array.isArray(c.signals) && c.signals.length ? c.signals.slice(0, 2).join(" · ") : "";
          return '<div class="pair"><strong>' + (c.symbol || "—") + '</strong>' +
            '<span class="blue">' + (score != null ? "score " + score : "—") + '</span></div>' +
            (top ? '<div class="sub" style="margin:-6px 0 6px">' + top + '</div>' : "");
        }).join("");
      }
      var statusEl = document.getElementById("scan-status");
      var stale = AIC.bridgeLinkState(data).stale;
      var errBits = Array.isArray(data.errors) && data.errors.length ? data.errors.length + " failed" : "";
      statusEl.textContent = stale ? AIC.bridgeLinkState(data).label : errBits;
      statusEl.className = stale ? "status stale" : (errBits ? "status stale" : "status");
      AIC.notifySize();
    });
  };
  `,
);

/* ─────────────────────────── levels report ───────────────────────────
 * detect_levels returns support/resistance clusters with a deterministic
 * strength score (touches + relative volume + recency), not the price/RSI/
 * MACD/decision shape the reused "analysis" template expects — that reuse
 * rendered an empty or misleading card (Phase 0 finding §2.2). This is
 * evidence-first (Pattern C: verdict-free here, since detect_levels makes
 * no trade call): current price, nearest support/resistance, then every
 * detected level with the inputs behind its score — never a bare number. */
const levelsReport = widgetHtml(
  "AiChart levels",
  `<div class="card" id="lv-card">
    <div class="top">
      <div><div class="title" id="lv-title">—</div></div>
      <div class="tag" id="lv-structure">—</div>
    </div>
    <div class="main" id="lv-body"><div class="skel"></div></div>
    <div class="row">
      <div class="mini"><span data-i18n="support">Support</span><strong id="lv-sup" class="green">—</strong></div>
      <div class="mini"><span data-i18n="resistance">Resistance</span><strong id="lv-res" class="red">—</strong></div>
    </div>
    <div class="foot">
      <span id="lv-status" class="status"></span>
    </div>
  </div>`,
  `
  function obj(v){ return v && typeof v === "object" ? v : {}; }
  function structClass(s){
    s = String(s || "").toLowerCase();
    if (s === "uptrend") return ["green", "trend.uptrend"];
    if (s === "downtrend") return ["red", "trend.downtrend"];
    if (s === "range") return ["amber", "trend.range"];
    return ["", "trend.unknown"];
  }
  function levelRow(AIC, lv, cls){
    var price = AIC.num(lv && lv.price);
    if (price == null) return "";
    var bits = [];
    if (lv.touches != null) bits.push(lv.touches + "×");
    if (lv.strengthScore != null) bits.push("score " + Math.round(lv.strengthScore));
    return '<div class="pair"><strong class="' + cls + '">' + AIC.fmt(price, 5) + '</strong>' +
      '<span>' + bits.join(" · ") + '</span></div>';
  }
  window.__aicReady = function (AIC){
    AIC.applyStaticLabels();
    AIC.onData(function (data){
      data = obj(data);
      document.getElementById("lv-title").textContent = (data.symbol || "—") + (data.interval ? " · " + data.interval : "");
      var sc = structClass(data.structure);
      var structEl = document.getElementById("lv-structure");
      structEl.className = "tag " + (sc[0] || "");
      structEl.textContent = AIC.t(sc[1]);
      var price = AIC.num(data.currentPrice);
      var sup = AIC.num(data.nearestSupport);
      var res = AIC.num(data.nearestResistance);
      document.getElementById("lv-sup").textContent = sup != null ? AIC.fmt(sup, 5) : "—";
      document.getElementById("lv-res").textContent = res != null ? AIC.fmt(res, 5) : "—";
      var supports = Array.isArray(data.supports) ? data.supports.slice().sort(function(a,b){return (b.strengthScore||0)-(a.strengthScore||0);}) : [];
      var resistances = Array.isArray(data.resistances) ? data.resistances.slice().sort(function(a,b){return (b.strengthScore||0)-(a.strengthScore||0);}) : [];
      var body = document.getElementById("lv-body");
      var rows = "";
      if (price != null) rows += '<div class="pair"><strong>' + AIC.t("price") + '</strong><span class="blue">' + AIC.fmt(price, 5) + '</span></div>';
      resistances.slice(0, 2).forEach(function (r) { rows += levelRow(AIC, r, "red"); });
      supports.slice(0, 2).forEach(function (s) { rows += levelRow(AIC, s, "green"); });
      body.innerHTML = rows || ('<div class="empty">' + (data.summary || AIC.t("noData")) + '</div>');
      var statusEl = document.getElementById("lv-status");
      var stale = AIC.bridgeLinkState(data).stale;
      statusEl.textContent = stale ? AIC.bridgeLinkState(data).label : (data.summary || "");
      statusEl.className = stale ? "status stale" : "status";
      AIC.notifySize();
    });
  };
  `,
);

export const WIDGETS: Record<string, string> = {
  "account-overview": accountOverview,
  analysis,
  "recommendation-card": recommendationCard,
  "scan-results": scanResults,
  "levels-report": levelsReport,
  "account-status": accountOverview,
  "pair-picker": genericCard("pairPickerTitle", "pairPickerSubtitle"),
  "risk-status": genericCard("riskStatusTitle", "riskStatusSubtitle"),
  "open-trades": openTradesCard,
  "approval-card": approvalCard,
  "approval-queue": approvalQueue,
  "market-snapshot": analysis,
  "mtf-analysis": analysis,
  "chart-drawn": liveChart,
  "live-chart": liveChart,
  portfolio: accountOverview,
  "trade-readiness": genericCard("tradeReadinessTitle", "tradeReadinessSubtitle"),
  "lessons-card": genericCard("lessonsTitle", "lessonsSubtitle"),
};
