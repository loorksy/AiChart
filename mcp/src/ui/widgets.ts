import { publicAssetOrigin, widgetHtml } from "./runtime.js";

const PLATFORM_ORIGIN = publicAssetOrigin();

const analysis = widgetHtml(
  "Lonora analysis",
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
  var current = { symbol: "", interval: "15m", layout_id: null, data_source: "metaapi" };
  function canonSym(s){
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
      current.symbol = canonSym(snap.symbol || rec.symbol || data.symbol || current.symbol);
      current.interval = snap.interval || data.interval || current.interval;
      current.layout_id = data.layout_id || current.layout_id;
      current.data_source = data.data_source || data.dataSource || current.data_source || "metaapi";
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
    `Lonora ${titleKey}`,
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

const LIVE_CHART_CSS = `
  html,body{background:transparent!important;padding:0;margin:0;height:100%}
  .tv-live{position:relative;width:100%;min-height:340px;height:380px;background:transparent;overflow:hidden}
  .tv-live iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent}
  .tv-rail{position:absolute;z-index:2;top:10px;inset-inline-start:12px;display:flex;align-items:center;gap:10px;pointer-events:none}
  .tv-live-dot{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--up)}
  .tv-live-dot::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-inline-end:6px;vertical-align:middle;box-shadow:0 0 0 4px color-mix(in srgb, var(--up) 22%, transparent)}
  .tv-id{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.02em}
  .tv-hint{position:absolute;inset:0;display:none;place-items:center;color:var(--faint);font-size:12px;font-weight:700;padding:24px;text-align:center;background:transparent;z-index:1}
  .tv-hint.show{display:grid}
`;

const liveChart = widgetHtml(
  "Lonora live chart",
  `<div class="tv-live" id="tv-live">
    <div class="tv-rail">
      <span class="tv-live-dot" id="live-tag">LIVE</span>
      <span class="tv-id" id="title">—</span>
    </div>
    <iframe id="tv" title="TradingView" allowtransparency="true"></iframe>
    <div id="hint" class="tv-hint"></div>
  </div>`,
  `
  var ORIGIN = "${PLATFORM_ORIGIN}";
  var S = { symbol:null, interval:"15m", layoutId:null, drawings:[], rec:null,
            targets:[], studies:[], theme:"dark", locale:"ar", booted:false,
            failures:0, timer:null, frameReady:false, embedUrl:null };

  function canonSym(s){
    s = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return s.length >= 6 ? s.slice(0, 6) : s;
  }
  function origin(){
    try { return new URL(ORIGIN).origin; } catch (e) { return "https://aichart.lork.cloud"; }
  }
  function isBoundEmbed(url){
    if (!url || typeof url !== "string") return false;
    try {
      var u = new URL(url);
      return u.origin === origin() && u.pathname === "/embed/chart" && !!u.searchParams.get("token");
    } catch (e) { return false; }
  }
  function embedSrc(){
    var url = S.embedUrl;
    if (!isBoundEmbed(url)) return "";
    if (url.indexOf("theme=") < 0)
      url += (url.indexOf("?") >= 0 ? "&" : "?") + "theme=" + encodeURIComponent(S.theme || "dark");
    if (url.indexOf("locale=") < 0)
      url += "&locale=" + encodeURIComponent(S.locale || "ar");
    return url;
  }
  function applyPayload(d){
    d = d || {};
    var prevSym = S.symbol, prevIv = S.interval, prevLid = S.layoutId;
    if (d.symbol) S.symbol = canonSym(d.symbol);
    if (d.interval) S.interval = String(d.interval);
    if (d.layout_id) S.layoutId = d.layout_id;
    if (d.id && (d.state || d.drawings_count != null || d.embed_url)) S.layoutId = d.id;
    if (d.theme === "light" || d.theme === "dark") S.theme = d.theme;
    if (d.locale) S.locale = String(d.locale);
    var st = (d.state && typeof d.state === "object") ? d.state : null;
    if (st) {
      if (Array.isArray(st.drawings)) S.drawings = st.drawings;
      if (st.recommendation !== undefined) S.rec = st.recommendation;
      if (Array.isArray(st.targets)) S.targets = st.targets;
      if (Array.isArray(st.studies)) S.studies = st.studies;
    }
    if (Array.isArray(d.drawings)) S.drawings = d.drawings;
    if (d.recommendation !== undefined) S.rec = d.recommendation;
    if (Array.isArray(d.targets)) S.targets = d.targets;
    if (Array.isArray(d.studies)) S.studies = d.studies;
    if (isBoundEmbed(d.embed_url)) {
      var identityChanged = S.symbol !== prevSym || S.interval !== prevIv || S.layoutId !== prevLid;
      if (!S.embedUrl || identityChanged) S.embedUrl = d.embed_url;
    }
  }
  function setTitle(){
    var fallback = window.AIC && window.AIC.t ? window.AIC.t("chartTitle") : "Chart";
    document.getElementById("title").textContent = S.symbol ? S.symbol + " · " + S.interval : fallback;
    var tag = document.getElementById("live-tag");
    tag.textContent = window.AIC && window.AIC.t ? window.AIC.t("connLive") : "LIVE";
  }
  function setHint(txt){
    var hint = document.getElementById("hint");
    if (!txt) { hint.className = "tv-hint"; hint.textContent = ""; return; }
    hint.className = "tv-hint show";
    hint.textContent = txt;
  }
  function pushState(){
    var f = document.getElementById("tv");
    if (!f || !f.contentWindow) return;
    try {
      f.contentWindow.postMessage({
        type: "aichart:live-chart",
        symbol: S.symbol,
        interval: S.interval,
        theme: S.theme,
        drawings: S.drawings,
        recommendation: S.rec,
        targets: S.targets,
        studies: S.studies
      }, origin());
    } catch (e) {}
  }
  function mountFrame(){
    var f = document.getElementById("tv");
    var next = embedSrc();
    if (!next) return;
    if (f.getAttribute("src") === next) { pushState(); return; }
    S.frameReady = false;
    f.onload = function () { S.frameReady = true; pushState(); };
    f.setAttribute("src", next);
  }
  function refresh(){
    setTitle();
    if (!embedSrc()) {
      setHint(window.AIC && window.AIC.t ? window.AIC.t("noBoundChart") : "Waiting for the linked account");
      var f = document.getElementById("tv");
      if (f) f.removeAttribute("src");
    } else {
      setHint("");
      mountFrame();
    }
    if (window.AIC) window.AIC.notifySize();
  }
  function schedule(ms){
    clearTimeout(S.timer);
    S.timer = setTimeout(tick, ms != null ? ms : (S.failures > 1 ? 12000 : 4000));
  }
  function tick(){
    if (document.hidden || !window.AIC) { schedule(); return; }
    if (!S.layoutId) { schedule(); return; }
    window.AIC.callTool("get_chart_state", { layout_id: S.layoutId }).then(function (res) {
      S.failures = 0;
      if (res && typeof res === "object") applyPayload(res);
      refresh();
      schedule();
    }).catch(function () {
      S.failures++;
      schedule();
    });
  }

  window.__aicReady = function (AIC) {
    AIC.applyStaticLabels();
    var hostTheme = document.documentElement.getAttribute("data-theme") ||
      (document.documentElement.classList.contains("dark") ? "dark" : "");
    if (hostTheme === "light" || hostTheme === "dark") S.theme = hostTheme;
    AIC.onData(function (data) {
      applyPayload(data);
      refresh();
      if (!S.booted) {
        S.booted = true;
        schedule(S.layoutId ? 4000 : 8000);
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        pushState();
        schedule(300);
      }
    });
  };
  `,
  LIVE_CHART_CSS,
);

/* ─────────────────────────── recommendation ───────────────────────────
 * Dedicated trade-idea card: action badge + confidence, entry/stop/target
 * ladder with computed R:R, rationale, factor chips. Also renders scan_market
 * multi-opportunity payloads as a ranked list. Reads the recommendation from
 * many shapes (create_recommendation, run_market_analysis, scan_market). */
const recommendationCard = widgetHtml(
  "Lonora recommendation",
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
  var PLATFORM = "${PLATFORM_ORIGIN}";
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

const scanResults = widgetHtml(
  "Lonora scan results",
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
  "Lonora levels",
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

/* ─────────────────────────── jobs report ───────────────────────────
 * show_jobs_by_ids: renders a whole batch of bucket-C job results
 * (run_market_analysis and similar) in ONE card instead of one display call
 * per job. Each job's own result shape can differ, so this deliberately does
 * NOT try to render any of them bespoke —
 * status first (queued/running never show fabricated numbers), then a
 * generic flattened key/value summary of whatever the completed result
 * actually contains, same discipline as the generic collections card. */
const jobsReport = widgetHtml(
  "Lonora jobs",
  `<div class="card" id="jobs-card">
    <div class="top">
      <div><div class="title" data-i18n="chartTitle">Jobs</div></div>
      <div class="tag" id="jobs-count">—</div>
    </div>
    <div class="main" id="jobs-body"><div class="skel"></div></div>
    <div class="foot">
      <span id="jobs-status" class="status"></span>
    </div>
  </div>`,
  `
  function obj(v){ return v && typeof v === "object" ? v : {}; }
  function statusCls(s){
    if (s === "completed") return "green";
    if (s === "failed") return "red";
    if (s === "not_found") return "";
    return "amber";
  }
  function summarize(AIC, result){
    result = obj(result);
    var out = [];
    for (var k in result) {
      if (out.length >= 3) break;
      var v = result[k];
      if (v == null) continue;
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
        var c = AIC.cell(v, 4);
        if (c) out.push(k + ": " + c);
      }
    }
    return out.join(" · ");
  }
  window.__aicReady = function (AIC){
    AIC.applyStaticLabels();
    AIC.onData(function (data){
      data = obj(data);
      var jobs = Array.isArray(data.jobs) ? data.jobs : [];
      document.getElementById("jobs-count").textContent = String(jobs.length);
      var body = document.getElementById("jobs-body");
      body.innerHTML = jobs.length ? jobs.map(function (j) {
        j = obj(j);
        var cls = statusCls(j.status);
        var line = j.status === "failed" ? String(j.error || "") : (j.status === "completed" ? summarize(AIC, j.result) : (j.status === "not_found" ? "unknown job_id" : "still running"));
        return '<div class="pair"><strong>' + (j.tool || j.id || "job") + '</strong>' +
          '<span class="' + cls + '">' + String(j.status || "—") + '</span></div>' +
          (line ? '<div class="sub" style="margin:-6px 0 6px">' + line + '</div>' : "");
      }).join("") : '<div class="empty">' + AIC.t("noData") + '</div>';
      var statusEl = document.getElementById("jobs-status");
      var stale = AIC.bridgeLinkState(data).stale;
      statusEl.textContent = stale ? AIC.bridgeLinkState(data).label : "";
      statusEl.className = stale ? "status stale" : "status";
      AIC.notifySize();
    });
  };
  `,
);

/**
 * Every widget a registered tool can point at.
 *
 * The account, open-trades, approval and trade-readiness cards were deleted
 * with the tools that rendered them. They were not merely unused: an approval
 * card carries Approve/Reject buttons that call `respond_approval`, and a
 * button wired to a tool this server no longer exposes is a control that fails
 * in the operator's hands. There is nothing to approve on a platform that
 * places no orders.
 */
export const WIDGETS: Record<string, string> = {
  analysis,
  "recommendation-card": recommendationCard,
  "scan-results": scanResults,
  "jobs-report": jobsReport,
  "levels-report": levelsReport,
  "pair-picker": genericCard("pairPickerTitle", "pairPickerSubtitle"),
  "risk-status": genericCard("riskStatusTitle", "riskStatusSubtitle"),
  "market-snapshot": analysis,
  "mtf-analysis": analysis,
  "chart-drawn": liveChart,
  "live-chart": liveChart,
  "lessons-card": genericCard("lessonsTitle", "lessonsSubtitle"),
};
