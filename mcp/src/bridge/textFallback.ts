function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function first(...values: unknown[]): unknown {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
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
  const live = obj(data.live);
  const forex = obj(live.forex);
  const ea = obj(forex.ea ?? live.ea ?? data.ea);
  const fresh =
    ea.heartbeatFresh === true || ea.online === true || ea.connected === true;
  const stale =
    ea.heartbeatFresh === false ||
    ea.online === false ||
    ea.connected === false ||
    /offline|stale|down/i.test(String(ea.status ?? ""));
  return stale || !fresh;
}

function formatAccountOverview(data: Record<string, unknown>): string {
  const risk = obj(data.risk);
  const portfolio = obj(data.portfolio);
  const live = obj(data.live);
  // Source of truth: live EA account meta, then portfolio EA, then legacy keys.
  const eaLive = obj(obj(live.forex).ea);
  const eaPort = obj(obj(portfolio.forex).ea);
  const account = obj(portfolio.account ?? live.account ?? data.account);
  const stale = eaStale(data);
  const balance = first(eaLive.balance, eaPort.balance, account.balance, portfolio.balance, data.balance);
  const equity = first(eaLive.equity, eaPort.equity, account.equity, portfolio.equity, data.equity);
  const login = first(eaLive.account_login, eaPort.account_login);
  const broker = first(eaLive.broker_name, eaPort.broker_name);
  const tradeMode = String(first(eaLive.account_trade_mode, eaPort.account_trade_mode) ?? "");
  let openPnl = first(
    portfolio.openPnl,
    portfolio.open_pnl,
    account.openPnl,
    account.pnl,
    live.openPnl,
  );
  if (openPnl == null) {
    const positions = obj(live.forex).positions;
    if (Array.isArray(positions) && positions.length) {
      let sum = 0;
      let seen = false;
      for (const p of positions) {
        const profit = Number((p as Record<string, unknown>)?.profit);
        if (Number.isFinite(profit)) {
          sum += profit;
          seen = true;
        }
      }
      if (seen) openPnl = sum;
    }
  }
  const staleMark = stale ? " (قديم — EA غير متصل)" : "";
  const lines = [
    "حالة الحساب — Lonora",
    login || broker
      ? `الحساب: #${String(login ?? "—")} · ${String(broker ?? "—")}${tradeMode === "live" ? " · حقيقي" : tradeMode === "demo" ? " · تجريبي" : ""}`
      : "",
    `الرصيد: ${fmtNum(balance)}${balance != null ? staleMark : ""}`,
    `حقوق الملكية: ${fmtNum(equity)}${equity != null ? staleMark : ""}`,
    `PnL المفتوح: ${stale || openPnl == null ? "— / بيانات قديمة" : fmtNum(openPnl)}`,
    `إعداد حد الصفقة: ${fmtNum(first(risk.perTradeMaxUsd, risk.per_trade_max_usd, data.perTradeMaxUsd), 0)} USD (قيمة إعداد، ليست الرصيد)`,
    `الصفقات المفتوحة: ${formatOpenTrades(first(portfolio.openTrades, portfolio.open_trades, data.openTrades, data.trades))}`,
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
  return "risk" in data && ("portfolio" in data || "live" in data);
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
