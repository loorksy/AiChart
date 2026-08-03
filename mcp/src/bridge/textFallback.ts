type Locale = "en" | "ar";

const MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    buy: "Buy",
    sell: "Sell",
    accountTitle: "Account status — AiChart",
    accountLine: "Account: #{login} · {broker}{mode}",
    liveMode: " · Live",
    demoMode: " · Demo",
    balance: "Balance: {val}",
    equity: "Equity: {val}",
    openPnl: "Open PnL: {val}",
    openPnlStale: "— / no data",
    openTrades: "Open trades: {val}",
    analysisTitle: "Analysis {symbol} — AiChart",
    trend: "Trend: {val}",
    price: "Price: {val}",
    rsi: "RSI: {val}",
    macd: "MACD: {val}",
    support: "Support: {val}",
    resistance: "Resistance: {val}",
    decision: "Decision: {action} ({conf}%)",
    entry: "Entry: {val}",
    stop: "Stop: {val}",
    target: "Target: {val}",
    liveChart: "Live chart {symbol} @ {interval}",
    candles: "Candles: {n}",
    lastPrice: "Last price: {val}",
    drawings: "Drawings: {n}",
    noLayout: "(no saved layout — drawings unavailable)",
  },
  ar: {
    buy: "شراء",
    sell: "بيع",
    accountTitle: "حالة الحساب — AiChart",
    accountLine: "الحساب: #{login} · {broker}{mode}",
    liveMode: " · حقيقي",
    demoMode: " · تجريبي",
    balance: "الرصيد: {val}",
    equity: "حقوق الملكية: {val}",
    openPnl: "PnL المفتوح: {val}",
    openPnlStale: "— / لا توجد بيانات",
    openTrades: "الصفقات المفتوحة: {val}",
    analysisTitle: "تحليل {symbol} — AiChart",
    trend: "الاتجاه: {val}",
    price: "السعر: {val}",
    rsi: "RSI: {val}",
    macd: "MACD: {val}",
    support: "الدعم: {val}",
    resistance: "المقاومة: {val}",
    decision: "القرار: {action} ({conf}%)",
    entry: "الدخول: {val}",
    stop: "الوقف: {val}",
    target: "الهدف: {val}",
    liveChart: "شارت حي {symbol} @ {interval}",
    candles: "شموع: {n}",
    lastPrice: "آخر سعر: {val}",
    drawings: "رسومات: {n}",
    noLayout: "(لا يوجد layout محفوظ — الرسومات غير متاحة)",
  },
};

function hasArabicScript(s: unknown): boolean {
  return /[\u0600-\u06FF]/.test(String(s ?? ""));
}

/** Mirror widget runtime locale policy: explicit field → Arabic prose → default English. */
export function resolveTextFallbackLocale(data: Record<string, unknown>): Locale {
  const loc = first(data.locale, data.lang, data.operatorLocale, data.uiLocale);
  if (loc != null) {
    return String(loc).toLowerCase().startsWith("ar") ? "ar" : "en";
  }
  const probe = [
    data.reply,
    data.summary,
    data.rationale,
    data.message,
    data.note,
    obj(data.recommendation).rationale,
  ];
  for (const v of probe) {
    if (hasArabicScript(v)) return "ar";
  }
  return "en";
}

function msg(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  let s = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

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
  return x.toLocaleString(undefined, { maximumFractionDigits: digits, useGrouping: false });
}

function formatOpenTrades(v: unknown, locale: Locale): string {
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
      const sideLbl =
        side === "buy" ? msg("buy", locale) : side === "sell" ? msg("sell", locale) : side || "—";
      const pnl = row.pnl ?? row.open_pnl ?? row.profit;
      const pnlStr =
        pnl != null && Number.isFinite(Number(pnl)) ? ` · PnL ${fmtNum(pnl)}` : "";
      return `${sym} ${sideLbl}${pnlStr}`;
    })
    .join(" | ");
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

function formatAccountOverview(data: Record<string, unknown>, locale: Locale): string {
  const portfolio = unwrapBridge(data.portfolio);
  const live = unwrapBridge(data.live);
  const liveForex = obj(live.forex);
  const dataForex = obj(data.forex);
  const connection = obj(first(live.connection, liveForex.connection, data.connection, dataForex.connection));
  const account = obj(first(portfolio.account, live.account, data.account, connection));
  const balance = first(
    connection.balance,
    account.balance,
    portfolio.balance,
    live.balance,
    data.balance,
  );
  const equity = first(
    connection.equity,
    account.equity,
    portfolio.equity,
    live.equity,
    data.equity,
  );
  const login = first(connection.login, account.login);
  const broker = first(connection.server, account.server);
  const tradeMode = String(first(connection.account_trade_mode, account.account_trade_mode) ?? "");
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
  const modeSuffix =
    tradeMode === "live"
      ? msg("liveMode", locale)
      : tradeMode === "demo"
        ? msg("demoMode", locale)
        : "";
  const lines = [
    msg("accountTitle", locale),
    login || broker
      ? msg("accountLine", locale, {
          login: String(login ?? "—"),
          broker: String(broker ?? "—"),
          mode: modeSuffix,
        })
      : "",
    msg("balance", locale, { val: fmtNum(balance) }),
    msg("equity", locale, { val: fmtNum(equity) }),
    msg("openPnl", locale, {
      val: openPnl == null ? msg("openPnlStale", locale) : fmtNum(openPnl),
    }),
    msg("openTrades", locale, { val: formatOpenTrades(openTrades, locale) }),
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

function formatAnalysis(data: Record<string, unknown>, locale: Locale): string {
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
    msg("analysisTitle", locale, { symbol }),
    msg("trend", locale, { val: trend }),
    msg("price", locale, { val: fmtNum(first(snap.price, snap.close, rec.entry, data.price), 5) }),
    msg("rsi", locale, { val: fmtNum(first(snap.rsi14, snap.rsi, extra.rsi14, data.rsi), 1) }),
    msg("macd", locale, { val: String(first(snap.macd, extra.macd, data.macd) ?? "—") }),
    msg("support", locale, {
      val: fmtNum(first(snap.support, snap.nearestSupport, data.support), 5),
    }),
    msg("resistance", locale, {
      val: fmtNum(first(snap.resistance, snap.nearestResistance, data.resistance), 5),
    }),
  ];
  if (rec.action) {
    lines.push(
      msg("decision", locale, {
        action: String(rec.action),
        conf: fmtNum(rec.confidence, 0),
      }),
    );
  }
  if (rec.entry != null) lines.push(msg("entry", locale, { val: fmtNum(rec.entry, 5) }));
  if (rec.stop_loss != null) lines.push(msg("stop", locale, { val: fmtNum(rec.stop_loss, 5) }));
  if (targets[0] != null) lines.push(msg("target", locale, { val: fmtNum(targets[0], 5) }));
  const summary = String(
    first(data.reply, snap.summary, rec.rationale, data.summary, data.narrative) ?? "",
  ).slice(0, 280);
  if (summary) lines.push("", summary);
  return lines.filter(Boolean).join("\n");
}

/** Compact text for the live-chart card payload — the heavy candle series
 *  lives in structuredContent for the widget; the model only needs a line. */
function formatLiveChart(data: Record<string, unknown>, locale: Locale): string {
  const ohlc = obj(data.ohlc);
  const candles = Array.isArray(ohlc.candles) ? ohlc.candles : [];
  const last = candles.length
    ? (candles[candles.length - 1] as Record<string, unknown>).close
    : null;
  const state = obj(data.state);
  const drawings = Array.isArray(state.drawings) ? state.drawings.length : 0;
  const parts = [
    msg("liveChart", locale, {
      symbol: String(data.symbol ?? "—"),
      interval: String(data.interval ?? "—"),
    }),
    msg("candles", locale, { n: candles.length }),
    last != null ? msg("lastPrice", locale, { val: fmtNum(last, 5) }) : "",
    msg("drawings", locale, { n: drawings }),
    data.layout_id ? "" : msg("noLayout", locale),
  ];
  return parts.filter(Boolean).join(" · ");
}

function isAccountOverview(data: Record<string, unknown>): boolean {
  const forex = obj(data.forex);
  return (
    ("risk" in data && ("portfolio" in data || "live" in data)) ||
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

/** Readable fallback for card-linked tool results (non-UI hosts). Locale mirrors operator language. */
export function formatToolTextFallback(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const locale = resolveTextFallbackLocale(o);
  if (o.live_chart === true) return formatLiveChart(o, locale);
  if (isAccountOverview(o)) return formatAccountOverview(o, locale);
  if (isAnalysis(o)) return formatAnalysis(o, locale);
  return null;
}
