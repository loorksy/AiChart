import { widgetHtml } from "./runtime.js";

const LIVE_CHART_CSS = `
  html,body{background:transparent!important;padding:0;margin:0;height:100%}
  .tv-live{position:relative;width:100%;min-height:340px;height:380px;background:transparent;overflow:hidden}
  .tv-live canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  .tv-rail{position:absolute;z-index:2;top:10px;inset-inline-start:12px;display:flex;align-items:center;gap:10px;pointer-events:none}
  .tv-live-dot{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--up)}
  .tv-live-dot::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-inline-end:6px;vertical-align:middle;box-shadow:0 0 0 4px color-mix(in srgb, var(--up) 22%, transparent)}
  .tv-id{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.02em}
  .tv-price{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums}
  .tv-hint{position:absolute;inset:0;display:none;place-items:center;color:var(--faint);font-size:12px;font-weight:700;padding:24px;text-align:center;background:transparent;z-index:1}
  .tv-hint.show{display:grid}
`;

const liveChart = widgetHtml(
  "Lonora live chart",
  `<div class="tv-live" id="tv-live">
    <div class="tv-rail">
      <span class="tv-live-dot" id="live-tag">LIVE</span>
      <span class="tv-id" id="title">—</span>
      <span class="tv-price" id="price-lbl">—</span>
    </div>
    <canvas id="cv"></canvas>
    <div id="hint" class="tv-hint"></div>
  </div>`,
  `
  var S = { symbol:null, interval:"15m", layoutId:null, candles:[],
            drawings:[], rec:null, targets:[], lastUpdate:0,
            failures:0, timer:null, booted:false, warning:null, drawTries:0 };

  function canonSym(s){
    s = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return s.length >= 6 ? s.slice(0, 6) : s;
  }
  function nnum(v){ v = Number(v); return isFinite(v) ? v : null; }
  function toMs(t){ t = Number(t); if (!isFinite(t) || t <= 0) return null; return t < 20000000000 ? t * 1000 : t; }
  function isLightTheme(){
    try {
      var t = document.documentElement.getAttribute("data-theme");
      if (t === "light" || t === "dark") return t === "light";
      return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    } catch (e) { return false; }
  }
  /* Canvas cannot paint CSS var()/light-dark() — use resolved hex palettes. */
  function theme(){
    if (isLightTheme()) {
      return {
        up: "#0f766e", down: "#be123c", gold: "#b45309", info: "#1d4ed8",
        muted: "#57534e", line: "rgba(28,25,23,.18)",
        surface: "#f4f3ee", txt: "#141413"
      };
    }
    return {
      up: "#5eead4", down: "#fb7185", gold: "#fbbf24", info: "#7dd3fc",
      muted: "#e2e8f0", line: "rgba(226,232,240,.28)",
      surface: "#0b1220", txt: "#f8fafc"
    };
  }
  function parseRgb(c){
    c = String(c || "").trim();
    if (c.charAt(0) !== "#") return null;
    var h = c.slice(1);
    if (h.length === 3 || h.length === 4) {
      return [
        parseInt(h.charAt(0)+h.charAt(0), 16),
        parseInt(h.charAt(1)+h.charAt(1), 16),
        parseInt(h.charAt(2)+h.charAt(2), 16)
      ];
    }
    if (h.length === 6 || h.length === 8) {
      return [
        parseInt(h.slice(0,2), 16),
        parseInt(h.slice(2,4), 16),
        parseInt(h.slice(4,6), 16)
      ];
    }
    return null;
  }
  function inkOn(bg){
    var rgb = parseRgb(bg);
    if (!rgb) return "#f8fafc";
    var r = rgb[0]/255, gv = rgb[1]/255, b = rgb[2]/255;
    var lin = function (x){ return x <= 0.04045 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4); };
    var L = 0.2126*lin(r) + 0.7152*lin(gv) + 0.0722*lin(b);
    return L > 0.45 ? "#141413" : "#f8fafc";
  }
  function paintChip(g, x, y, w, h, fill, label){
    g.globalAlpha = 1;
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
    g.fillStyle = inkOn(fill);
    g.textAlign = "left";
    g.fillText(label, x + 4, y + h / 2);
  }
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
    if (d.symbol) S.symbol = canonSym(d.symbol);
    if (d.interval) S.interval = String(d.interval);
    if (d.layout_id) S.layoutId = d.layout_id;
    if (d.id && (d.state || d.drawings_count != null)) S.layoutId = d.id;
    var st = (d.state && typeof d.state === "object") ? d.state : null;
    if (st) {
      if (Array.isArray(st.drawings)) S.drawings = st.drawings;
      if (st.recommendation !== undefined) S.rec = st.recommendation;
      if (Array.isArray(st.targets)) S.targets = st.targets;
    }
    if (Array.isArray(d.drawings)) S.drawings = d.drawings;
    if (d.recommendation !== undefined) S.rec = d.recommendation;
    if (Array.isArray(d.targets)) S.targets = d.targets;
    var cc = null;
    var ohl = d.ohlc;
    if (ohl && ohl.data && typeof ohl.data === "object") ohl = ohl.data;
    var flat = d.data && typeof d.data === "object" ? d.data : d;
    if (ohl) {
      cc = normCandles(ohl);
      S.warning = ohl.warning || null;
    } else if (Array.isArray(flat.candles)) {
      cc = normCandles(flat);
      S.warning = flat.warning || null;
    }
    if (cc && cc.length) { S.candles = cc; S.lastUpdate = Date.now(); }
  }

  function roleColor(th, dr){
    var r = String(dr.semanticRole || dr.type || dr.label || "").toLowerCase();
    if (/support|demand|take_profit|target|هدف/.test(r)) return th.up;
    if (/resistance|supply|stop|وقف/.test(r)) return th.down;
    if (/entry|fib|forecast|دخول/.test(r)) return th.gold;
    if (dr.color && /^#[0-9a-fA-F]{3,8}$/.test(dr.color)) return dr.color;
    return th.info;
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
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) {
      S.drawTries = (S.drawTries || 0) + 1;
      if (S.drawTries < 40 && window.requestAnimationFrame) window.requestAnimationFrame(draw);
      return;
    }
    S.drawTries = 0;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    var cs = S.candles;
    if (!cs.length) return;
    var th = theme();
    var UP = th.up, DOWN = th.down, GOLD = th.gold, INFO = th.info;
    var MUTED = th.muted, LINE = th.line;

    var padL = 6, padR = 56, padT = 36, padB = 20;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var N = Math.min(200, cs.length), i0 = cs.length - N;
    var lo = Infinity, hi = -Infinity;
    for (var i = i0; i < cs.length; i++) { if (cs[i].l < lo) lo = cs[i].l; if (cs[i].h > hi) hi = cs[i].h; }
    var span0 = hi - lo || Math.abs(hi) * 0.001 || 1;
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
    function xFor(idx){ var ii = idx < i0 ? i0 : idx; return padL + (ii - i0 + 0.5) * step; }
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

    g.font = "10px system-ui, sans-serif"; g.textBaseline = "middle";
    for (var gl = 0; gl <= 4; gl++) {
      var gp = lo + span * gl / 4, gy = yFor(gp);
      g.strokeStyle = LINE; g.globalAlpha = 0.55; g.beginPath();
      g.moveTo(padL, gy); g.lineTo(W - padR, gy); g.stroke(); g.globalAlpha = 1;
      g.fillStyle = MUTED; g.textAlign = "left";
      g.fillText(fmtP(gp, dec), W - padR + 5, gy);
    }
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
      g.strokeStyle = color; g.lineWidth = 1.25;
      g.setLineDash(dash === "dashed" ? [5,4] : dash === "dotted" ? [2,3] : []);
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.setLineDash([]);
      if (label) {
        g.font = "bold 10px system-ui, sans-serif";
        var tw = g.measureText(label).width + 10;
        paintChip(g, padL + 2, y - 8, tw, 16, color, label);
        g.font = "10px system-ui, sans-serif";
      }
    }

    for (var z = 0; z < S.drawings.length; z++) {
      var dz = S.drawings[z] || {};
      var tz = String(dz.type || "").toLowerCase();
      if (!/zone|range_box|band|risk_reward/.test(tz)) continue;
      var pts = Array.isArray(dz.points) ? dz.points : [];
      var p1 = nnum(pts[0] && pts[0].price != null ? pts[0].price : dz.price);
      var p2 = nnum(pts[1] && pts[1].price != null ? pts[1].price : dz.price2);
      if (p1 == null || p2 == null) continue;
      var zc = roleColor(th, dz);
      var y1 = yFor(Math.max(p1, p2)), y2 = yFor(Math.min(p1, p2));
      var zx1 = pts[0] ? ptX(pts[0]) : null, zx2 = pts[1] ? ptX(pts[1]) : null;
      var rx = zx1 != null ? Math.min(zx1, zx2 != null ? zx2 : W - padR) : padL;
      var rw = (zx2 != null ? Math.max(zx1 != null ? zx1 : padL, zx2) : W - padR) - rx;
      if (rw < 8) { rx = padL; rw = plotW; }
      g.fillStyle = zc; g.globalAlpha = 0.10; g.fillRect(rx, y1, rw, y2 - y1);
      g.globalAlpha = 0.5; g.strokeStyle = zc; g.strokeRect(rx, y1, rw, y2 - y1);
      g.globalAlpha = 1;
      if (dz.label) {
        g.font = "bold 10px system-ui, sans-serif";
        var zlbl = String(dz.label);
        paintChip(g, rx + 4, y1 + 2, g.measureText(zlbl).width + 10, 16, zc, zlbl);
        g.font = "10px system-ui, sans-serif";
      }
    }

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

    for (var di = 0; di < S.drawings.length; di++) {
      var dr = S.drawings[di] || {};
      var ty = String(dr.type || "").toLowerCase();
      if (/zone|range_box|band|risk_reward/.test(ty)) continue;
      var col = roleColor(th, dr);
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
      if (/marker|arrow|text|label/.test(ty)) {
        var mp = ps[0];
        if (mp && mp.price != null) {
          var mx = ptX(mp), my = yFor(nnum(mp.price));
          if (mx != null) {
            g.fillStyle = col; g.beginPath(); g.arc(mx, my, 3.5, 0, 7); g.fill();
            if (dr.label) {
              var ml = String(dr.label);
              g.font = "bold 10px system-ui, sans-serif";
              paintChip(g, mx - 2, my - 18, g.measureText(ml).width + 10, 16, col, ml);
              g.font = "10px system-ui, sans-serif";
            }
          }
        }
        continue;
      }
      if (/position/.test(ty)) {
        var meta = dr.meta || {};
        var en = nnum(meta.entry), sl = nnum(meta.stopLoss), tp = nnum(meta.takeProfit);
        if (en != null) hline(en, GOLD, "dashed", chartLbl("entry", fmtP(en, dec)));
        if (sl != null) hline(sl, DOWN, "dashed", chartLbl("stop", fmtP(sl, dec)));
        if (tp != null) hline(tp, UP, "dashed", chartLbl("target", fmtP(tp, dec)));
        continue;
      }
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
          if (lbx != null) {
            var pl = String(dr.label);
            g.font = "bold 10px system-ui, sans-serif";
            paintChip(g, lbx + 4, yFor(nnum(ps[0].price)) - 16, g.measureText(pl).width + 10, 16, col, pl);
            g.font = "10px system-ui, sans-serif";
          }
        }
      }
    }

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

    var last = cs[cs.length - 1];
    var lpY = yFor(last.c);
    var lastFill = last.c >= last.o ? UP : DOWN;
    g.strokeStyle = lastFill;
    g.setLineDash([2,3]); g.beginPath(); g.moveTo(padL, lpY); g.lineTo(W - padR, lpY); g.stroke(); g.setLineDash([]);
    g.font = "bold 10px system-ui, sans-serif";
    paintChip(g, W - padR + 1, lpY - 8, padR - 3, 16, lastFill, fmtP(last.c, dec));
  }

  function setTitle(){
    var fallback = window.AIC && window.AIC.t ? window.AIC.t("chartTitle") : "Chart";
    document.getElementById("title").textContent = S.symbol ? S.symbol + " · " + S.interval : fallback;
    var tag = document.getElementById("live-tag");
    tag.textContent = window.AIC && window.AIC.t ? window.AIC.t("connLive") : "LIVE";
  }
  function setPrice(){
    var priceEl = document.getElementById("price-lbl");
    var last = S.candles.length ? S.candles[S.candles.length - 1] : null;
    if (last) {
      var lo = last.l, hi = last.h;
      for (var ci = 0; ci < S.candles.length; ci++) {
        lo = Math.min(lo, S.candles[ci].l);
        hi = Math.max(hi, S.candles[ci].h);
      }
      priceEl.textContent = fmtP(last.c, decimalsFor(hi - lo));
      priceEl.className = "tv-price " + (last.c >= last.o ? "green" : "red");
    } else {
      priceEl.textContent = "—";
      priceEl.className = "tv-price";
    }
  }
  function setHint(txt){
    var hint = document.getElementById("hint");
    if (!txt) { hint.className = "tv-hint"; hint.textContent = ""; return; }
    hint.className = "tv-hint show";
    hint.textContent = txt;
  }
  function refresh(){
    setTitle(); setPrice();
    if (!S.symbol) {
      setHint(window.AIC && window.AIC.t ? window.AIC.t("noSymbolHint") : "No symbol yet");
    } else if (!S.candles.length) {
      setHint(S.warning
        ? String(S.warning)
        : (window.AIC && window.AIC.t ? window.AIC.t("noCandles") : "No candles available"));
    } else {
      setHint("");
    }
    draw();
    if (window.AIC) window.AIC.notifySize();
  }

  function schedule(ms){
    clearTimeout(S.timer);
    S.timer = setTimeout(tick, ms != null ? ms : (S.failures > 1 ? 10000 : 4000));
  }
  function tick(){
    if (document.hidden || !S.symbol || !window.AIC) { schedule(); return; }
    var args = { symbol: canonSym(S.symbol), interval: S.interval, limit: 200 };
    var calls = [window.AIC.callTool("get_ohlc", args)];
    if (S.layoutId) calls.push(window.AIC.callTool("get_chart_state", { layout_id: S.layoutId }));
    Promise.all(calls).then(function (res) {
      S.failures = 0;
      if (res[0] && typeof res[0] === "object") applyPayload({ ohlc: res[0] });
      if (res[1] && typeof res[1] === "object") applyPayload(res[1]);
      refresh();
      schedule();
    }).catch(function () {
      S.failures++;
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
        schedule(S.candles.length ? 4000 : 600);
      }
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) schedule(300);
    });
    window.addEventListener("resize", draw);
    window.addEventListener("aic:theme", function () { refresh(); });
  };
  `,
  LIVE_CHART_CSS,
);

const MARK_SVG = `<svg class="rec-mark" viewBox="100 250 900 670" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M258.63 274.35C278.01 271.86 299.01 274.62 317.66 279.79C400.53 302.73 452.07 386.95 434.75 471.32C429.32 497.75 416.93 522.49 399.9 543.35C387.04 559.1 370.42 572.4 352.62 582.11C332.62 593.02 310.2 599.97 287.5 601.87C266.99 603.59 245.9 601.15 226.28 595.25C140.5 569.44 90.62 477.72 116.16 391.6C120.93 375.53 128.1 359.97 137.59 346.1C149.4 328.83 164.29 313.8 181.6 302.02C204.84 286.21 230.99 277.9 258.63 274.35ZM805.76 274.41C816.59 272.9 828.7 273.63 839.5 274.88C922.33 284.44 985.94 354.65 985.59 438.5C985.23 523.81 919.85 593.52 835.5 601.82C819.14 603.43 802.12 601.81 786.13 598.45C698.33 580 642.8 491.95 660.29 404.7C671.01 351.17 710.18 305.39 760.72 285.23C775.29 279.42 790.31 276.58 805.76 274.41ZM542.79 642.35C558.84 638.96 571.8 654.43 583.11 663.41C612.25 686.55 640.77 710.54 670.12 733.39C677.05 738.78 683.77 744.46 690.68 749.87C696 754.03 701.29 758.22 701.91 765.5C702.24 769.44 700.84 773.79 698.44 776.94C693.51 783.4 678.53 793.35 671.57 799.05C643.15 822.33 614.44 845.3 585.64 868.09C575.11 876.42 561.61 891.61 547.5 891.6C533.22 891.59 519.55 876.01 508.84 867.63C480.11 845.16 451.58 822.27 423.45 799.04C416.48 793.28 401.51 783.42 396.56 776.93C394.19 773.81 392.75 769.41 393.08 765.5C393.67 758.5 398.66 754.34 403.8 750.32C411.09 744.63 418.24 738.74 425.43 732.94C452.38 711.24 479.12 689.25 506.32 667.87C516.1 660.19 530.89 644.87 542.79 642.35Z"/></svg>`;

const COPY_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="14" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2"/></svg>`;

const REC_CSS = `
  #rec-card{
    border:none!important;box-shadow:none!important;outline:none!important;
    background:transparent!important;min-height:0!important;
    padding:4px 0;max-width:100%;gap:0
  }
  #rec-card.buy,#rec-card.sell,#rec-card.wait{border:none!important}
  #rec-card .foot{border-top:0;padding-top:8px}
  #rec-card .foot:not(:has(.status:not(:empty))){display:none}
  .rec-head{display:flex;align-items:center;gap:10px}
  .rec-mark{width:28px;height:28px;color:var(--txt);flex:none;display:block}
  .rec-meta{flex:1;min-width:0}
  .rec-sym{font-size:12px;font-weight:700;color:var(--muted);line-height:1.2}
  .rec-side{font-size:18px;font-weight:800;margin-top:2px;line-height:1.2}
  .rec-conf{font-size:12px;font-weight:800;color:var(--muted);margin-inline-start:auto;flex:none;font-variant-numeric:tabular-nums}
  .rec-levels{display:flex;flex-direction:column;gap:8px;margin-top:14px}
  .rec-level{
    display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;
    border:1px solid var(--line-soft);background:var(--surface-2)
  }
  .rec-level .k{flex:1;font-size:12px;font-weight:700;color:var(--muted)}
  .rec-level .v{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums}
  .rec-copy{
    flex:none;width:32px;height:32px;display:grid;place-items:center;color:var(--muted);
    cursor:pointer;-webkit-tap-highlight-color:transparent;border-radius:8px
  }
  .rec-copy.ok{color:var(--up)}
`

const recommendationCard = widgetHtml(
  "Lonora recommendation",
  `<div class="card" id="rec-card">
    <div class="rec-head">
      ${MARK_SVG}
      <div class="rec-meta">
        <div class="rec-sym" id="title">—</div>
        <div class="rec-side" id="side">—</div>
      </div>
      <div class="rec-conf" id="badge">—</div>
    </div>
    <div class="rec-levels" id="levels"></div>
    <div class="foot"><span id="status" class="status"></span></div>
  </div>`,
  `
  function obj(v){ return v && typeof v === "object" ? v : {}; }
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
  function pickRec(data){
    data = unwrapPayload(data);
    if (data.recommendation_card) return obj(data.recommendation_card);
    if (data.recommendation && !Array.isArray(data.recommendation)) return obj(data.recommendation);
    if (data.best || data.pick || data.selected) return obj(data.best || data.pick || data.selected);
    if (data.action || data.side || data.decision || data.direction || data.signal || data.entry || data.stop_loss || data.take_profit) return data;
    var lists = [data.opportunities, data.results, data.candidates, data.picks, data.scan, data.top, data.recommendations];
    if (Array.isArray(data.recommendation)) lists.push(data.recommendation);
    for (var i=0;i<lists.length;i++){
      if (Array.isArray(lists[i]) && lists[i].length) return obj(lists[i][0]);
    }
    return {};
  }
  function flattenLevelVals(vals){
    var out = [];
    function push(v){
      if (v == null || v === "") return;
      if (Array.isArray(v)) { for (var i=0;i<v.length;i++) push(v[i]); return; }
      if (typeof v === "object") {
        push(v.price); push(v.value); push(v.level); push(v.take_profit); push(v.tp);
        return;
      }
      out.push(v);
    }
    for (var i=0;i<vals.length;i++) push(vals[i]);
    return out;
  }
  function uniqNums(AIC, vals){
    var out = [];
    vals = flattenLevelVals(vals);
    for (var i=0;i<vals.length;i++){
      var n = AIC.num(vals[i]);
      if (n == null) continue;
      var seen = false;
      for (var j=0;j<out.length;j++) if (out[j] === n) { seen = true; break; }
      if (!seen) out.push(n);
    }
    return out;
  }
  function esc(s){
    return String(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/"/g,"&quot;");
  }
  function copyIcon(){ return ${JSON.stringify(COPY_SVG)}; }
  function levelRow(label, value, tone){
    var txt = value == null ? "—" : String(value);
    return '<div class="rec-level"><span class="k">'+esc(label)+'</span><strong class="v '+tone+'">'+esc(txt)+
      '</strong><span class="rec-copy" data-copy="'+esc(txt)+'" title="copy">'+copyIcon()+'</span></div>';
  }
  function fallbackCopy(text){
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly","readonly");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }
  function copyText(text){
    text = String(text || "");
    if (!text || text === "—") return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function(){ fallbackCopy(text); });
    } else fallbackCopy(text);
  }

  window.__aicReady = function (AIC){
    AIC.applyStaticLabels();
    var levelsEl = document.getElementById("levels");
    levelsEl.addEventListener("click", function (ev) {
      var t = ev.target;
      while (t && t !== levelsEl) {
        if (t.getAttribute && t.getAttribute("data-copy")) {
          copyText(t.getAttribute("data-copy"));
          t.className = "rec-copy ok";
          setTimeout(function(){ t.className = "rec-copy"; }, 900);
          return;
        }
        t = t.parentNode;
      }
    });
    AIC.onData(function (data){
      data = unwrapPayload(data);
      var rec = pickRec(data);
      var act = AIC.actInfo(first(rec.action, rec.side, rec.decision, rec.direction, rec.signal, rec.type));
      var symbol = first(rec.symbol, rec.sym, data.symbol, data.baseSymbol) || "";
      var tf = first(rec.timeframe, rec.interval, data.timeframe, data.interval, "15m");
      document.getElementById("title").textContent = symbol ? symbol + " · " + tf : "—";
      document.getElementById("rec-card").className = "card";
      var sideEl = document.getElementById("side");
      var sigCls = act.cls==="buy"?"green":act.cls==="sell"?"red":"amber";
      sideEl.className = "rec-side " + sigCls;
      sideEl.textContent = act.label || "—";
      var conf = AIC.num(first(rec.confidence, rec.score, rec.probability, data.confidence, data.score));
      if (conf != null && conf > 0 && conf <= 1) conf = conf * 100;
      document.getElementById("badge").textContent = conf != null ? Math.round(conf) + "%" : "—";
      var entry = AIC.num(first(rec.entry, rec.entry_price, rec.open, rec.price, rec.currentPrice));
      var sl = AIC.num(first(rec.stop_loss, rec.stopLoss, rec.stop, rec.sl));
      var tps = uniqNums(AIC, [
        rec.targets, rec.take_profits, rec.takeProfits, rec.tps,
        data.targets, data.take_profits,
        rec.take_profit, rec.takeProfit, rec.target, rec.tp, rec.tp1, rec.tp2, rec.tp3
      ]);
      if (act.dir !== 0) tps.sort(function (a, b) { return act.dir > 0 ? a - b : b - a; });
      var rows = "";
      if (entry != null) rows += levelRow(AIC.t("entryLabel"), AIC.fmt(entry, 5), "blue");
      if (sl != null) rows += levelRow(AIC.t("stopLoss"), AIC.fmt(sl, 5), "red");
      for (var i=0;i<tps.length;i++){
        var lab = tps.length === 1 ? AIC.t("targetLabel") : (AIC.t("target") + " " + (i+1));
        rows += levelRow(lab, AIC.fmt(tps[i], 5), "green");
      }
      levelsEl.innerHTML = rows || ('<div class="empty">'+AIC.t("noRecommendation")+'</div>');
      var stale = AIC.bridgeLinkState(data).stale;
      var statusEl = document.getElementById("status");
      statusEl.textContent = stale ? AIC.bridgeLinkState(data).label : "";
      statusEl.className = stale ? "status stale" : "status";
      AIC.notifySize();
    });
  };
  `,
  REC_CSS,
);

export const WIDGETS: Record<string, string> = {
  "recommendation-card": recommendationCard,
  "chart-drawn": liveChart,
  "live-chart": liveChart,
};
