function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function unwrapBridge(v: unknown): Record<string, unknown> {
  const o = obj(v);
  if (o.ok === true && o.data != null && typeof o.data === "object") {
    return o.data as Record<string, unknown>;
  }
  return o;
}

function first(...values: unknown[]): unknown {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function hasKeys(v: unknown): boolean {
  return Object.keys(obj(v)).length > 0;
}

function fmtNum(n: unknown, digits = 2): string {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatOpenTrades(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (!Array.isArray(v)) return String(v);
  if (!v.length) return "0";
  return v
    .map((t) => {
      if (!t || typeof t !== "object") return String(t);
      const row = t as Record<string, unknown>;
      const sym = String(row.symbol ?? row.sym ?? "?");
      const side = String(row.side ?? "").toLowerCase();
      const sideAr = side === "buy" ? "شراء" : side === "sell" ? "بيع" : side || "—";
      const pnl = row.pnl ?? row.open_pnl ?? row.profit;
      const pnlStr =
        pnl != null && Number.isFinite(Number(pnl)) ? ` · PnL ${fmtNum(pnl)}` : "";
      return `${sym} ${sideAr}${pnlStr}`;
    })
    .join(" | ");
}

function eaStale(data: Record<string, unknown>): boolean {
  const live = unwrapBridge(data.live);
  const liveForex = obj(live.forex);
  const dataForex = obj(data.forex);
  const portfolioForex = obj(unwrapBridge(data.portfolio).forex);
  const ea = obj(first(liveForex.ea, dataForex.ea, portfolioForex.ea, live.ea, data.ea));
  const heartbeatFresh = first(
    ea.heartbeatFresh,
    liveForex.heartbeatFresh,
    dataForex.heartbeatFresh,
    live.heartbeatFresh,
    data.heartbeatFresh,
  );
  const online = first(
    ea.online,
    ea.connected,
    liveForex.online,
    dataForex.online,
    live.online,
    data.online,
  );
  const status = String(
    first(ea.status, liveForex.status, dataForex.status, live.status, data.status) ?? "",
  );
  const fresh =
    heartbeatFresh === true ||
    online === true ||
    /online|connected|live/i.test(status);
  const stale =
    heartbeatFresh === false ||
    online === false ||
    /offline|stale|down|revoked/i.test(status);
  const known =
    heartbeatFresh != null || online != null || status !== "" || hasKeys(ea);
  return known ? stale || !fresh : false;
}

function sumPnl(...values: unknown[]): number | null {
  for (const v of values) {
    if (!Array.isArray(v)) continue;
    let sum = 0;
    let seen = false;
    for (const row of v) {
      const item = obj(row);
      const profit = Number(first(item.profit, item.pnl, item.open_pnl, item.openPnl));
      if (Number.isFinite(profit)) {
        sum += profit;
        seen = true;
      }
    }
    if (seen) return sum;
  }
  return null;
}

function formatAccountOverview(data: Record<string, unknown>): string {
  /* Host may pass get_live_account flat payload instead of get_account_overview wrapper. */
  if (!obj(data.live).forex && obj(data.forex).ea) {
    data = { ...data, live: data };
  }
  const risk = unwrapBridge(data.risk);
  const portfolio = unwrapBridge(data.portfolio);
  const live = unwrapBridge(data.live);
  const cap = obj(risk.capital);
  const liveForex = obj(live.forex);
  const dataForex = obj(data.forex);
  const portfolioForex = obj(portfolio.forex);
  // Source of truth: live/account payloads, then portfolio EA, then legacy keys.
  const eaLive = obj(liveForex.ea);
  const eaDirect = obj(dataForex.ea);
  const eaPort = obj(portfolioForex.ea);
  const connection = obj(first(live.connection, liveForex.connection, data.connection, dataForex.connection));
  const account = obj(first(portfolio.account, live.account, data.account, connection));
  const stale = eaStale(data);
  const balance = first(
    eaLive.balance,
    eaDirect.balance,
    eaPort.balance,
    connection.balance,
    account.balance,
    portfolio.balance,
    live.balance,
    data.balance,
  );
  const equity = first(
    eaLive.equity,
    eaDirect.equity,
    eaPort.equity,
    connection.equity,
    account.equity,
    portfolio.equity,
    live.equity,
    data.equity,
  );
  const login = first(eaLive.account_login, eaDirect.account_login, eaPort.account_login, connection.account_login);
  const broker = first(eaLive.broker_name, eaDirect.broker_name, eaPort.broker_name, connection.broker_name);
  const tradeMode = String(
    first(
      eaLive.account_trade_mode,
      eaDirect.account_trade_mode,
      eaPort.account_trade_mode,
      connection.account_trade_mode,
    ) ?? "",
  );
  let openPnl = first(
    portfolio.openPnl,
    portfolio.open_pnl,
    account.openPnl,
    account.pnl,
    live.openPnl,
    live.open_pnl,
    data.openPnl,
    data.open_pnl,
  );
  if (openPnl == null) {
    openPnl = sumPnl(
      liveForex.positions,
      dataForex.positions,
      live.positions,
      data.positions,
      portfolio.openTrades,
      portfolio.open_trades,
      data.openTrades,
      data.trades,
    );
  }
  const openTrades = first(
    portfolio.openTrades,
    portfolio.open_trades,
    data.openTrades,
    data.open_trades,
    data.trades,
    live.openTrades,
    live.open_trades,
  );
  const staleMark = stale ? " (قديم — EA غير متصل)" : "";
  const lines = [
    "حالة الحساب — Lonora",
    login || broker
      ? `الحساب: #${String(login ?? "—")} · ${String(broker ?? "—")}${tradeMode === "live" ? " · حقيقي" : tradeMode === "demo" ? " · تجريبي" : ""}`
      : "",
    `الرصيد: ${fmtNum(balance)}${balance != null ? staleMark : ""}`,
    `حقوق الملكية: ${fmtNum(equity)}${equity != null ? staleMark : ""}`,
    `PnL المفتوح: ${stale || openPnl == null ? "— / بيانات قديمة" : fmtNum(openPnl)}`,
    `إعداد حد الصفقة: ${fmtNum(first(cap.perTradeMaxUsd, risk.perTradeMaxUsd, risk.per_trade_max_usd, data.perTradeMaxUsd), 0)} USD (قيمة إعداد، ليست الرصيد)`,
    cap.effectiveCapital != null
      ? `رأس المال الفعّال: ${fmtNum(cap.effectiveCapital, 0)} USD`
      : "",
    `الصفقات المفتوحة: ${formatOpenTrades(openTrades)}`,
    stale ? "تنبيه: EA غير متصل أو الأسعار قديمة." : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function pickSnapshot(data: Record<string, unknown>): Record<string, unknown> {
  if (data.snapshot && typeof data.snapshot === "object") {
    return obj(data.snapshot);
  }
  const snaps = data.snapshots;
  if (Array.isArray(snaps) && snaps.length) {
    const firstSnap = snaps[0] as Record<string, unknown>;
    return obj(firstSnap.snapshot ?? firstSnap);
  }
  return data;
}

function formatAnalysis(data: Record<string, unknown>): string {
  const rec = obj(data.recommendation);
  const snap = pickSnapshot(data);
  const extra = obj(snap.extra);
  const targets = Array.isArray(rec.targets)
    ? rec.targets
    : Array.isArray(data.targets)
      ? data.targets
      : [];
  const symbol = String(first(snap.symbol, rec.symbol, data.symbol) ?? "—");
  const trend = String(
    first(snap.trend, extra.trend, rec.trend, data.trend) ?? "neutral",
  );
  const lines = [
    `تحليل ${symbol} — Lonora`,
    `الاتجاه: ${trend}`,
    `السعر: ${fmtNum(first(snap.price, snap.close, rec.entry, data.price), 5)}`,
    `RSI: ${fmtNum(first(snap.rsi14, snap.rsi, extra.rsi14, data.rsi), 1)}`,
    `MACD: ${String(first(snap.macd, extra.macd, data.macd) ?? "—")}`,
    `الدعم: ${fmtNum(first(snap.support, snap.nearestSupport, data.support), 5)}`,
    `المقاومة: ${fmtNum(first(snap.resistance, snap.nearestResistance, data.resistance), 5)}`,
  ];
  if (rec.action) lines.push(`القرار: ${String(rec.action)} (${fmtNum(rec.confidence, 0)}%)`);
  if (rec.entry != null) lines.push(`الدخول: ${fmtNum(rec.entry, 5)}`);
  if (rec.stop_loss != null) lines.push(`الوقف: ${fmtNum(rec.stop_loss, 5)}`);
  if (targets[0] != null) lines.push(`الهدف: ${fmtNum(targets[0], 5)}`);
  const summary = String(
    first(data.reply, snap.summary, rec.rationale, data.summary, data.narrative) ?? "",
  ).slice(0, 280);
  if (summary) lines.push("", summary);
  return lines.filter(Boolean).join("\n");
}

/** Compact text for the live-chart card payload — the heavy candle series
 *  lives in structuredContent for the widget; the model only needs a line. */
function formatLiveChart(data: Record<string, unknown>): string {
  const ohlc = obj(data.ohlc);
  const candles = Array.isArray(ohlc.candles) ? ohlc.candles : [];
  const last = candles.length
    ? (candles[candles.length - 1] as Record<string, unknown>).close
    : null;
  const state = obj(data.state);
  const drawings = Array.isArray(state.drawings) ? state.drawings.length : 0;
  const parts = [
    `شارت حي ${String(data.symbol ?? "—")} @ ${String(data.interval ?? "—")}`,
    `شموع: ${candles.length}`,
    last != null ? `آخر سعر: ${fmtNum(last, 5)}` : "",
    `رسومات: ${drawings}`,
    data.layout_id ? "" : "(لا يوجد layout محفوظ — الرسومات غير متاحة)",
  ];
  return parts.filter(Boolean).join(" · ");
}

function isAccountOverview(data: Record<string, unknown>): boolean {
  const forex = obj(data.forex);
  return (
    ("risk" in data && ("portfolio" in data || "live" in data)) ||
    hasKeys(obj(forex.ea)) ||
    hasKeys(obj(data.connection)) ||
    data.balance != null ||
    data.equity != null ||
    Array.isArray(forex.positions) ||
    Array.isArray(data.positions)
  );
}

function isAnalysis(data: Record<string, unknown>): boolean {
  return (
    "snapshot" in data ||
    "snapshots" in data ||
    "recommendation" in data ||
    (typeof data.symbol === "string" &&
      (data.rsi14 != null ||
        data.rsi != null ||
        data.price != null ||
        data.summary != null))
  );
}

/** Readable Arabic fallback for card-linked tool results (non-UI hosts). */
export function formatToolTextFallback(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.live_chart === true) return formatLiveChart(o);
  if (isAccountOverview(o)) return formatAccountOverview(o);
  if (isAnalysis(o)) return formatAnalysis(o);
  return null;
}
