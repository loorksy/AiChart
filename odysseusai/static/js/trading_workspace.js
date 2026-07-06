/**
 * Odysseus Trading Workspace — chat-centric trading UI wired to the native
 * Python engine (/api/trading/*). The user talks to the agent; the agent opens
 * a chart, posts an analysis verdict, and — per the active mode — either just
 * advises (manual), prepares an editable ticket to Execute (semi-auto), or
 * auto-executes through the Risk Guard (full-auto).
 */

import { mountTvWidget, isTvAvailable } from "./tv_chart.js";

const API = "/api/trading";
const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  symbol: "EURUSD",
  interval: "15m",
  mode: "approval", // direct=manual | approval=semi | auto=full
  env: "demo",
  settings: null,
  isAdmin: false,
  estop: false,
};

// ── API helpers ──────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.reason || data.detail || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n, d = 5) => (n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(d));

// ── Chat stream ──────────────────────────────────────────
const stream = () => $("#tw-stream");
function scrollDown() { const s = stream(); s.scrollTop = s.scrollHeight; }

function userMsg(text) {
  const el = document.createElement("div");
  el.className = "tw-msg user";
  el.innerHTML = `<div class="tw-bubble">${esc(text)}</div>`;
  stream().appendChild(el);
  scrollDown();
}
function agentMsg(node) {
  const el = document.createElement("div");
  el.className = "tw-msg agent";
  el.innerHTML = `<div class="tw-agent-label"><span class="tw-dot"></span> Odysseus Agent</div>`;
  if (typeof node === "string") {
    const b = document.createElement("div"); b.className = "tw-card"; b.innerHTML = `<div class="tw-card-body">${node}</div>`;
    el.appendChild(b);
  } else el.appendChild(node);
  stream().appendChild(el);
  scrollDown();
  return el;
}

// ── Candlestick chart (canvas, OANDA candles) ────────────
function chartCard(symbol, interval) {
  const card = document.createElement("div");
  card.className = "tw-card";
  card.innerHTML =
    `<div class="tw-card-head"><span class="sym">${esc(symbol)}</span> <span class="tf">${esc(interval)}</span>` +
    `<span class="tf">OANDA</span><button class="close" title="إغلاق">✕</button></div>` +
    `<div class="tw-chart-wrap"><div class="tw-tv-mount" style="display:none"></div>` +
    `<canvas class="tw-chart-canvas"></canvas>` +
    `<div class="tw-chart-empty" style="display:none"></div></div>`;
  card.querySelector(".close").onclick = () => card.remove();
  return card;
}

function drawCandles(canvas, candles) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 300;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (!candles || !candles.length) return;
  const padL = 6, padR = 58, padT = 10, padB = 18;
  const view = candles.slice(-120);
  const highs = view.map((c) => c.high), lows = view.map((c) => c.low);
  let hi = Math.max(...highs), lo = Math.min(...lows);
  const range = hi - lo || 1; hi += range * 0.06; lo -= range * 0.06;
  const cw = (w - padL - padR) / view.length;
  const cssVar = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d);
  const green = cssVar("--tw-green", "#26a269"), red = cssVar("--tw-red", "#e01b24");
  const grid = cssVar("--border", "#355a66"), muted = cssVar("--color-muted", "#8a94a6");
  const yOf = (p) => padT + (1 - (p - lo) / (hi - lo)) * (h - padT - padB);
  // grid + price axis
  ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.font = "10px system-ui"; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const p = lo + ((hi - lo) * i) / 4, y = yOf(p);
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(p.toFixed(5), w - padR + 4, y + 3);
  }
  view.forEach((c, i) => {
    const x = padL + i * cw + cw / 2;
    const up = c.close >= c.open;
    ctx.strokeStyle = up ? green : red; ctx.fillStyle = up ? green : red; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, yOf(c.high)); ctx.lineTo(x, yOf(c.low)); ctx.stroke();
    const bw = Math.max(1, cw * 0.6);
    const yo = yOf(c.open), yc = yOf(c.close);
    ctx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
  });
}

function overlayLevels(canvas, candles, levels) {
  if (!candles || !candles.length || !levels) return;
  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 300;
  const ctx = canvas.getContext("2d");
  const padR = 58, padT = 10, padB = 18;
  const view = candles.slice(-120);
  let hi = Math.max(...view.map((c) => c.high)), lo = Math.min(...view.map((c) => c.low));
  const range = hi - lo || 1; hi += range * 0.06; lo -= range * 0.06;
  const yOf = (p) => padT + (1 - (p - lo) / (hi - lo)) * (h - padT - padB);
  const cssVar = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d);
  const map = { entry: cssVar("--tw-accent", "#00aaff"), stop_loss: cssVar("--tw-red", "#e01b24"), take_profit: cssVar("--tw-green", "#26a269") };
  ctx.save(); ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ["entry", "stop_loss", "take_profit"].forEach((k) => {
    const p = levels[k]; if (p == null) return;
    const y = yOf(p); if (y < padT || y > h - padB) return;
    ctx.strokeStyle = map[k]; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w - padR, y); ctx.stroke();
  });
  ctx.restore();
}

async function loadChart(card, symbol, interval, levels) {
  const canvas = card.querySelector(".tw-chart-canvas");
  const empty = card.querySelector(".tw-chart-empty");
  const tvMount = card.querySelector(".tw-tv-mount");

  // Prefer the licensed TradingView Advanced Charting Library when installed
  // (native change-frame / drag / zoom / drawing tools). Fall back to the
  // built-in canvas renderer when the vendor bundle is absent.
  if (tvMount && (await isTvAvailable())) {
    try {
      canvas.style.display = "none";
      empty.style.display = "none";
      tvMount.style.display = "block";
      tvMount.style.height = "340px";
      await mountTvWidget(tvMount, { symbol, interval, levels });
      card._tv = true;
      return null;
    } catch (e) {
      tvMount.style.display = "none";
      canvas.style.display = "block";
      // fall through to canvas
    }
  }
  try {
    const data = await api(`/market/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&count=200`);
    if (!data.configured) {
      canvas.style.display = "none"; empty.style.display = "block";
      empty.textContent = "OANDA غير مُهيّأ — أضف مفتاح OANDA من لوحة الوسيط لعرض الشموع الحيّة.";
      return null;
    }
    if (!data.candles.length) {
      canvas.style.display = "none"; empty.style.display = "block";
      empty.textContent = "لا تتوفر شموع لهذا الرمز.";
      return null;
    }
    drawCandles(canvas, data.candles);
    if (levels) overlayLevels(canvas, data.candles, levels);
    card._candles = data.candles;
    return data.candles;
  } catch (e) {
    canvas.style.display = "none"; empty.style.display = "block";
    empty.textContent = "تعذّر جلب الشموع: " + e.message;
    return null;
  }
}

// ── Analysis verdict card ────────────────────────────────
function analysisCard(a) {
  const card = document.createElement("div");
  card.className = "tw-card";
  const dir = a.direction || "neutral";
  const reasons = (a.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
  card.innerHTML =
    `<div class="tw-card-head"><span class="sym">${esc(a.symbol)}</span> <span class="tf">${esc(a.interval)}</span> · تقرير التحليل</div>` +
    `<div class="tw-card-body">` +
    `<div class="tw-verdict"><span class="pill ${dir}">${esc(a.verdict)}</span>` +
    `<span class="conf">الثقة ${esc(a.confidence)}%${a.reward_risk ? " · R:R " + esc(a.reward_risk) : ""}</span></div>` +
    (dir !== "neutral"
      ? `<div class="tw-levels">` +
        `<div class="lv"><div class="k">السعر</div><div class="v">${fmt(a.price)}</div></div>` +
        `<div class="lv"><div class="k">الدخول</div><div class="v">${fmt(a.entry)}</div></div>` +
        `<div class="lv sl"><div class="k">وقف الخسارة</div><div class="v">${fmt(a.stop_loss)}</div></div>` +
        `<div class="lv tp"><div class="k">الهدف</div><div class="v">${fmt(a.take_profit)}</div></div>` +
        `</div>` : "") +
    `<ul class="tw-reasons">${reasons}</ul>` +
    (a.cancellation != null ? `<div class="tw-note">شرط الإلغاء: كسر ${fmt(a.cancellation)} يُبطل الصفقة.</div>` : "") +
    `<div class="tw-note">${esc(a.note || "")}</div>` +
    `</div>`;
  return card;
}

// ── Execute ticket (semi-auto) ───────────────────────────
function executeCard(a) {
  const card = document.createElement("div");
  card.className = "tw-card";
  const side = a.direction === "sell" ? "sell" : "buy";
  const suggestedSize = state.settings ? (state.settings.max_capital * state.settings.per_trade_pct / 100) : 20;
  card.innerHTML =
    `<div class="tw-card-head">تجهيز الصفقة — <span class="sym">${esc(a.symbol)}</span> · ${side === "buy" ? "شراء" : "بيع"}</div>` +
    `<div class="tw-card-body">` +
    `<div class="tw-exec-grid">` +
    `<label>الدخول<input data-f="entry" type="number" step="any" value="${fmt(a.entry)}"></label>` +
    `<label>الحجم (USD)<input data-f="notional" type="number" step="any" value="${suggestedSize.toFixed(2)}"></label>` +
    `<label>وقف الخسارة<input data-f="stop_loss" type="number" step="any" value="${fmt(a.stop_loss)}"></label>` +
    `<label>الهدف<input data-f="take_profit" type="number" step="any" value="${fmt(a.take_profit)}"></label>` +
    `</div>` +
    `<div class="tw-actions">` +
    `<button class="tw-btn ${side === "sell" ? "sell" : "primary"}" data-act="exec">تنفيذ ▸</button>` +
    `<button class="tw-btn" data-act="dismiss">تجاهل</button>` +
    `</div><div class="tw-result" style="display:none"></div></div>`;

  const read = () => {
    const o = { symbol: a.symbol, side, confidence: a.confidence, approved: true, market: "forex" };
    card.querySelectorAll("[data-f]").forEach((el) => { if (el.value !== "") o[el.getAttribute("data-f")] = Number(el.value); });
    return o;
  };
  const result = card.querySelector(".tw-result");
  const showResult = (cls, msg) => { result.style.display = "block"; result.className = "tw-result " + cls; result.textContent = msg; };
  card.querySelector('[data-act="dismiss"]').onclick = () => card.remove();
  card.querySelector('[data-act="exec"]').onclick = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const r = await api("/trades/open", { method: "POST", body: read() });
      if (r.queued) showResult("queued", "أُدرجت الصفقة للموافقة (نيّة #" + r.intent.id.slice(0, 8) + ").");
      else showResult("ok", "نُفّذت الصفقة ✓ — راجع المحفظة/الصفقات المفتوحة.");
      refreshRail();
    } catch (e) {
      btn.disabled = false;
      showResult("err", "رُفضت: " + e.message);
    }
  };
  return card;
}

// ── Agent flow: analyze → chart + verdict → (mode) ───────
async function runAnalysis(symbol, interval) {
  symbol = (symbol || state.symbol).toUpperCase();
  interval = interval || state.interval;
  const holder = document.createElement("div");
  const chart = chartCard(symbol, interval);
  holder.appendChild(chart);
  agentMsg(holder);
  let a;
  try {
    a = await api(`/market/analyze?symbol=${encodeURIComponent(symbol)}&interval=${interval}`);
  } catch (e) {
    holder.appendChild(Object.assign(document.createElement("div"), { className: "tw-card", innerHTML: `<div class="tw-card-body tw-result err">تعذّر التحليل: ${esc(e.message)}</div>` }));
    return;
  }
  const levels = a.direction !== "neutral" ? { entry: a.entry, stop_loss: a.stop_loss, take_profit: a.take_profit } : null;
  await loadChart(chart, symbol, interval, levels);
  holder.appendChild(analysisCard(a));

  if (state.estop) { holder.appendChild(banner("الإيقاف الطارئ مفعّل — تحليل فقط، لا تنفيذ.")); return; }
  if (a.direction === "neutral") return;

  if (state.mode === "direct") {
    holder.appendChild(note("الوضع يدوي — توصية فقط، لم يُجهَّز أمر تنفيذ."));
  } else if (state.mode === "approval") {
    holder.appendChild(executeCard(a));
  } else if (state.mode === "auto") {
    await autoExecute(holder, a);
  }
}

async function autoExecute(holder, a) {
  const size = state.settings ? (state.settings.max_capital * state.settings.per_trade_pct / 100) : 20;
  try {
    const r = await api("/trades/open", {
      method: "POST",
      body: { symbol: a.symbol, side: a.direction, notional: size, entry: a.entry, stop_loss: a.stop_loss, take_profit: a.take_profit, confidence: a.confidence, market: "forex" },
    });
    holder.appendChild(note(r.queued ? "أُدرجت للموافقة (Risk Guard)." : "تنفيذ آلي ✓ عبر Risk Guard — سُجّل في دفتر الصفقات.", r.queued ? "queued" : "ok"));
    refreshRail();
  } catch (e) {
    holder.appendChild(note("رفض Risk Guard: " + e.message, "err"));
  }
}

function note(text, cls) {
  const d = document.createElement("div");
  d.className = "tw-card";
  d.innerHTML = `<div class="tw-card-body"><div class="tw-result ${cls || ""}" style="display:block">${esc(text)}</div></div>`;
  return d;
}
function banner(text) { return note(text, "err"); }

// ── Command parsing ──────────────────────────────────────
function handleCommand(text) {
  userMsg(text);
  const t = text.trim();
  const symMatch = t.match(/([A-Za-z]{6}|[A-Za-z]{3}_[A-Za-z]{3}|XAU[A-Za-z]{3}|XAG[A-Za-z]{3})/);
  const sym = symMatch ? symMatch[1].toUpperCase().replace("_", "") : state.symbol;
  const tfMatch = t.match(/\b(1m|5m|15m|30m|1h|4h|1d)\b/i);
  const tf = tfMatch ? tfMatch[1].toLowerCase() : state.interval;
  if (symMatch) { state.symbol = sym; $("#tw-symbol").value = sym; }
  if (tfMatch) { state.interval = tf; $("#tw-interval").value = tf; }

  if (/(حال[ةه]|الوضع|status|risk|مخاطر)/i.test(t)) return showStatus();
  if (/(شارت|chart|افتح)/i.test(t) && !/(حلل|analyz|تحليل)/i.test(t)) {
    const c = chartCard(sym, tf); const h = document.createElement("div"); h.appendChild(c); agentMsg(h); return loadChart(c, sym, tf, null);
  }
  // default: analyze
  return runAnalysis(sym, tf);
}

async function showStatus() {
  try {
    const rs = await api("/risk/status");
    const pf = await api("/portfolio");
    agentMsg(
      `<b>الحالة</b><br>الوضع: ${esc({ direct: "يدوي", approval: "نصف آلي", auto: "آلي كامل" }[rs.mode] || rs.mode)}` +
      ` · البيئة: ${esc(rs.env_preference)}` +
      `<br>Risk Guard: ${rs.risk_guard_enabled ? "مفعّل" : "متوقف"} · Kill switch: ${rs.kill_switch ? "مفعّل ⛔" : "لا"}` +
      `<br>الصفقات المفتوحة: ${esc(rs.open_trades)}/${esc(rs.max_open_trades)} · الربح المحقّق: ${fmt(pf.realized_pnl, 2)} USD`
    );
  } catch (e) { agentMsg("تعذّر جلب الحالة: " + esc(e.message)); }
}

// ── Rail: settings / portfolio / broker / admin ──────────
async function buildRail() {
  const rail = $("#tw-rail");
  const s = state.settings;
  rail.innerHTML = "";

  // Portfolio stats
  const pf = document.createElement("div"); pf.className = "tw-panel"; pf.id = "tw-portfolio";
  pf.innerHTML = `<div class="tw-panel-head"><span class="ic">◆</span> المحفظة</div><div class="tw-panel-body"><div class="tw-stats-grid" id="tw-pf-stats"></div><div id="tw-open-trades"></div></div>`;
  rail.appendChild(pf);

  // Broker status
  const br = document.createElement("div"); br.className = "tw-panel";
  br.innerHTML = `<div class="tw-panel-head"><span class="ic">⇄</span> الوسيط والبيانات</div><div class="tw-panel-body" id="tw-broker"></div>`;
  rail.appendChild(br);

  // Risk settings
  const rk = document.createElement("div"); rk.className = "tw-panel";
  rk.innerHTML =
    `<div class="tw-panel-head"><span class="ic">🛡</span> إدارة المخاطر</div><div class="tw-panel-body">` +
    rowNum("رأس المال (USD)", "max_capital", s.max_capital, 1) +
    rowNum("مخاطرة/صفقة %", "per_trade_pct", s.per_trade_pct, 0.1) +
    rowNum("أقصى صفقات مفتوحة", "max_open_trades", s.max_open_trades, 1) +
    rowNum("أدنى R:R", "min_rr", s.min_rr, 0.1) +
    rowNum("حد الخسارة اليومي %", "daily_loss_limit_pct", s.daily_loss_limit_pct, 0.5) +
    rowNum("حد الخسارة الشهري %", "monthly_loss_limit_pct", s.monthly_loss_limit_pct, 0.5) +
    rowSelect("البيئة", "env_preference", s.env_preference, [["demo", "تجريبي"], ["live", "حقيقي"]]) +
    rowCheck("Risk Guard التقني", "risk_guard_enabled", s.risk_guard_enabled) +
    `<div class="tw-hint">Risk Guard التقني يمنع أي أمر بدون وقف خسارة أو يتجاوز الحدود، حتى في الوضع الآلي.</div>` +
    `<div class="tw-save-row"><button class="tw-btn primary" id="tw-save-risk">حفظ</button></div>` +
    `</div>`;
  rail.appendChild(rk);
  $("#tw-save-risk").onclick = saveRisk;

  // Performance / learning
  const perf = document.createElement("div"); perf.className = "tw-panel";
  perf.innerHTML =
    `<div class="tw-panel-head"><span class="ic">📈</span> الأداء والتعلّم</div><div class="tw-panel-body">` +
    `<div id="tw-perf"></div>` +
    `<div class="tw-save-row"><button class="tw-btn" id="tw-backtest">اختبار تاريخي للرمز الحالي</button></div>` +
    `</div>`;
  rail.appendChild(perf);
  $("#tw-backtest").onclick = runBacktest;

  if (state.isAdmin) buildAdminPanel(rail);

  refreshRail();
}

async function runBacktest() {
  const btn = $("#tw-backtest"); btn.disabled = true; const o = btn.textContent; btn.textContent = "يعمل…";
  try {
    const r = await api(`/backtest?symbol=${encodeURIComponent(state.symbol)}&interval=${state.interval}`);
    if (r.error) { agentMsg("الاختبار التاريخي: " + esc(r.error)); }
    else agentMsg(
      `<b>اختبار تاريخي — ${esc(r.symbol)} ${esc(r.interval)}</b><br>` +
      `صفقات: ${r.trades} · نسبة الربح: ${(r.win_rate * 100).toFixed(0)}% · ` +
      `Profit Factor: ${r.profit_factor} · متوسط R:R: ${r.avg_rr}<br>` +
      `أقصى تراجع: ${r.max_drawdown}R · صافي: ${r.net_r}R`);
  } catch (e) { agentMsg("تعذّر الاختبار التاريخي: " + esc(e.message)); }
  finally { btn.disabled = false; btn.textContent = o; }
}

const rowNum = (label, f, v, step) => `<div class="tw-row"><label>${label}</label><input type="number" step="${step}" data-s="${f}" value="${v ?? ""}"></div>`;
const rowSelect = (label, f, v, opts) => `<div class="tw-row"><label>${label}</label><select data-s="${f}">${opts.map(([val, txt]) => `<option value="${val}" ${val === v ? "selected" : ""}>${txt}</option>`).join("")}</select></div>`;
const rowCheck = (label, f, v) => `<div class="tw-row"><label>${label}</label><input type="checkbox" data-s="${f}" ${v ? "checked" : ""}></div>`;

async function saveRisk() {
  const patch = {};
  document.querySelectorAll("[data-s]").forEach((el) => {
    const f = el.getAttribute("data-s");
    if (el.type === "checkbox") patch[f] = el.checked ? 1 : 0;
    else if (el.type === "number") patch[f] = Number(el.value);
    else patch[f] = el.value;
  });
  try {
    state.settings = await api("/settings", { method: "PATCH", body: patch });
    state.env = state.settings.env_preference;
    updateEnvBadge();
    flash($("#tw-save-risk"), "حُفظ ✓");
  } catch (e) { alert("تعذّر الحفظ: " + e.message); }
}
function flash(btn, txt) { const o = btn.textContent; btn.textContent = txt; setTimeout(() => (btn.textContent = o), 1500); }

async function refreshRail() {
  try {
    const pf = await api("/portfolio");
    const stats = $("#tw-pf-stats");
    if (stats) {
      const pnlCls = pf.realized_pnl > 0 ? "pos" : pf.realized_pnl < 0 ? "neg" : "";
      stats.innerHTML =
        `<div class="tw-stat"><div class="k">مفتوحة</div><div class="v">${pf.open_count}</div></div>` +
        `<div class="tw-stat"><div class="k">الربح المحقّق</div><div class="v ${pnlCls}">${fmt(pf.realized_pnl, 2)}</div></div>`;
    }
    const ot = $("#tw-open-trades");
    if (ot) ot.innerHTML = (pf.open_trades || []).map((t) =>
      `<div class="tw-trade-item"><span class="side ${t.side}">${t.side === "buy" ? "▲" : "▼"}</span>` +
      `<span class="sym">${esc(t.symbol)}</span><span class="tf">${fmt(t.entry)}</span>` +
      `<span class="pnl">${t.notional} USD</span></div>`).join("") || `<div class="tw-hint">لا صفقات مفتوحة.</div>`;
  } catch {}
  try {
    const p = await api("/journal/stats");
    const box = $("#tw-perf");
    if (box) {
      if (!p.trades) box.innerHTML = `<div class="tw-hint">لا صفقات مغلقة بعد — ستظهر إحصاءات الأداء هنا.</div>`;
      else box.innerHTML =
        `<div class="tw-stats-grid">` +
        `<div class="tw-stat"><div class="k">نسبة الربح</div><div class="v">${(p.win_rate * 100).toFixed(0)}%</div></div>` +
        `<div class="tw-stat"><div class="k">Profit Factor</div><div class="v">${p.profit_factor}</div></div>` +
        `<div class="tw-stat"><div class="k">صفقات</div><div class="v">${p.trades}</div></div>` +
        `<div class="tw-stat"><div class="k">أفضل رمز</div><div class="v" style="font-size:15px">${esc(p.best_symbol || "—")}</div></div>` +
        `</div>`;
    }
  } catch {}
  try {
    const b = await api("/broker/status");
    const box = $("#tw-broker");
    if (box) {
      box.innerHTML =
        statusLine("OANDA (بيانات السوق)", b.oanda) +
        statusLine("جسر MT5 (التنفيذ)", b.ea) +
        `<div class="tw-broker-actions">` +
        (!b.oanda
          ? `<div class="tw-field"><input class="tw-input" id="tw-oanda-key" placeholder="مفتاح OANDA" style="flex:1"><button class="tw-btn" id="tw-oanda-save">حفظ</button></div>`
          : "") +
        `<button class="tw-btn" id="tw-mt5-connect">ربط MetaTrader 5…</button>` +
        `<div class="tw-hint">بيانات السوق من OANDA · التنفيذ عبر جسر MT5 فقط.</div>` +
        `<div id="tw-mt5-token"></div>` +
        `</div>`;
      const oSave = $("#tw-oanda-save");
      if (oSave) oSave.onclick = async () => {
        const key = $("#tw-oanda-key").value.trim(); if (!key) return;
        try { await api("/broker/oanda", { method: "POST", body: { api_key: key } }); refreshRail(); }
        catch (e) { alert(e.message); }
      };
      $("#tw-mt5-connect").onclick = async () => {
        try {
          const r = await api("/broker/ea-token", { method: "POST" });
          $("#tw-mt5-token").innerHTML =
            `<div class="tw-result queued" style="display:block;word-break:break-all">` +
            `توكن الإكسبيرت (يظهر مرة واحدة): <b>${esc(r.token)}</b><br>` +
            `ApiBase: <b>${location.origin}</b> · المسار: <b>/api/ea-bridge</b><br>` +
            `أدخله في EaToken داخل OdysseusBridge (MT5) على جهازك.</div>`;
        } catch (e) { alert(e.message); }
      };
    }
  } catch {}
}
const statusLine = (label, on) => `<div class="tw-status-line"><span class="led ${on ? "on" : "off"}"></span> ${esc(label)} — ${on ? "متصل" : "غير متصل"}</div>`;

// ── Admin ────────────────────────────────────────────────
async function buildAdminPanel(rail) {
  let limits;
  try { limits = await api("/admin/limits"); } catch { return; } // not admin
  const p = document.createElement("div"); p.className = "tw-panel tw-admin";
  p.innerHTML =
    `<div class="tw-panel-head"><span class="ic">⚙</span> لوحة الأدمن</div><div class="tw-panel-body">` +
    rowCheckA("السماح بالتنفيذ (المنصة)", "can_execute", limits.can_execute) +
    rowNumA("سقف رأس المال (0=∞)", "max_capital_cap", limits.max_capital_cap, 1) +
    rowNumA("سقف الصفقات المفتوحة (0=∞)", "max_open_trades_cap", limits.max_open_trades_cap, 1) +
    `<div class="tw-save-row"><button class="tw-btn primary" id="tw-save-admin">حفظ الحدود</button></div>` +
    `<button class="tw-kill-btn ${limits.kill_switch ? "on" : ""}" id="tw-kill">${limits.kill_switch ? "⛔ إيقاف الطوارئ العام مفعّل — إلغاء" : "تفعيل إيقاف الطوارئ العام"}</button>` +
    `<div class="tw-hint">مفتاح الإيقاف العام يمنع كل التنفيذ لكل المستخدمين فوراً.</div>` +
    `</div>`;
  rail.appendChild(p);
  $("#tw-save-admin").onclick = async () => {
    const patch = {};
    p.querySelectorAll("[data-a]").forEach((el) => {
      const f = el.getAttribute("data-a");
      patch[f] = el.type === "checkbox" ? el.checked : Number(el.value);
    });
    try { await api("/admin/limits", { method: "PATCH", body: patch }); flash($("#tw-save-admin"), "حُفظ ✓"); }
    catch (e) { alert(e.message); }
  };
  $("#tw-kill").onclick = async () => {
    const on = !limits.kill_switch;
    try { await api("/admin/kill-switch", { method: "POST", body: { on } }); buildAdminPanelRefresh(rail); }
    catch (e) { alert(e.message); }
  };
}
const rowNumA = (label, f, v, step) => `<div class="tw-row"><label>${label}</label><input type="number" step="${step}" data-a="${f}" value="${v ?? ""}"></div>`;
const rowCheckA = (label, f, v) => `<div class="tw-row"><label>${label}</label><input type="checkbox" data-a="${f}" ${v ? "checked" : ""}></div>`;
function buildAdminPanelRefresh(rail) { const old = rail.querySelector(".tw-admin"); if (old) old.remove(); buildAdminPanel(rail); }

// ── Mode + env + estop ───────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".tw-mode-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  api("/settings", { method: "PATCH", body: { mode } }).then((s) => { state.settings = s; }).catch(() => {});
}
function updateEnvBadge() {
  const el = $("#tw-env");
  el.textContent = (state.env || "demo").toUpperCase();
  el.className = "tw-env-badge " + (state.env === "live" ? "live" : "demo");
}
function toggleEstop() {
  state.estop = !state.estop;
  $("#tw-banner").classList.toggle("show", state.estop);
  $("#tw-estop").classList.toggle("armed", state.estop);
  if (state.estop) {
    // Safe per-user stop: drop to analyze-only + disable Risk Guard bypass.
    setMode("direct");
    api("/settings", { method: "PATCH", body: { risk_guard_enabled: 1 } }).catch(() => {});
    agentMsg("⛔ <b>إيقاف طارئ</b> — تحوّل الوكيل إلى وضع التحليل فقط. لن تُنفَّذ أي صفقة حتى إلغاء الإيقاف.");
  } else {
    agentMsg("أُلغي الإيقاف الطارئ. يمكنك اختيار وضع التداول من الأعلى.");
  }
}

// ── Boot ─────────────────────────────────────────────────
async function boot() {
  // Wire top bar
  $("#tw-symbol").addEventListener("change", (e) => { state.symbol = e.target.value.toUpperCase().trim() || "EURUSD"; e.target.value = state.symbol; });
  $("#tw-interval").addEventListener("change", (e) => { state.interval = e.target.value; });
  document.querySelectorAll(".tw-mode-btn").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $("#tw-estop").onclick = toggleEstop;
  $("#tw-composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = $("#tw-input"); const v = inp.value.trim(); if (!v) return; inp.value = ""; handleCommand(v);
  });

  // Load settings + detect admin
  try { state.settings = await api("/settings"); }
  catch { state.settings = { max_capital: 1000, per_trade_pct: 2, max_open_trades: 3, min_rr: 1, daily_loss_limit_pct: 5, monthly_loss_limit_pct: 15, env_preference: "demo", risk_guard_enabled: 1, mode: "approval" }; }
  state.mode = state.settings.mode || "approval";
  state.env = state.settings.env_preference || "demo";
  $("#tw-interval").value = state.interval;
  setMode(state.mode);
  updateEnvBadge();
  try { await api("/admin/limits"); state.isAdmin = true; } catch { state.isAdmin = false; }

  await buildRail();

  agentMsg(
    `أهلاً بك في <b>Odysseus Trading</b>. أنا شريكك في التنفيذ — أحلّل السوق بصبر وأتحرّك عند الفرصة المناسبة فقط.<br>` +
    `جرّب: «حلّل EURUSD» أو «افتح شارت GBPUSD 1h» أو «الحالة». الوضع الحالي: <b>${{ direct: "يدوي", approval: "نصف آلي", auto: "آلي كامل" }[state.mode]}</b>.`
  );
}

document.addEventListener("DOMContentLoaded", boot);
