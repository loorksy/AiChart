import type { Trade } from "./types";

export type PeriodKey = "7d" | "30d" | "90d" | "180d" | "1y" | "all";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: "7d", label: "أسبوع", days: 7 },
  { key: "30d", label: "شهر", days: 30 },
  { key: "90d", label: "3 أشهر", days: 90 },
  { key: "180d", label: "6 أشهر", days: 180 },
  { key: "1y", label: "سنة", days: 365 },
  { key: "all", label: "الكل", days: null },
];

/** A closed trade has a realized pnl and a closed_at timestamp. */
function isClosed(t: Trade): boolean {
  return t.status === "closed" || t.status !== "open";
}

function tradeDate(t: Trade): Date {
  return new Date(t.closed_at ?? t.created_at);
}

export function filterByPeriod(trades: Trade[], period: PeriodKey): Trade[] {
  const opt = PERIOD_OPTIONS.find((p) => p.key === period);
  if (!opt || opt.days == null) return trades;
  const cutoff = Date.now() - opt.days * 24 * 60 * 60 * 1000;
  return trades.filter((t) => tradeDate(t).getTime() >= cutoff);
}

export interface PerformanceStats {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // %
  totalPnl: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
  maxDrawdown: number; // absolute currency value
  maxDrawdownPct: number; // %
  profitFactor: number;
  sharpeRatio: number;
  cumulativePnl: number;
}

/** Computes summary statistics from a list of trades. Presentation only. */
export function computeStats(trades: Trade[]): PerformanceStats {
  const open = trades.filter((t) => t.status === "open");
  const closed = trades
    .filter((t) => isClosed(t) && t.status !== "open")
    .slice()
    .sort((a, b) => tradeDate(a).getTime() - tradeDate(b).getTime());

  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  const totalPnl = closed.reduce((sum, t) => sum + t.pnl, 0);

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // Max drawdown from cumulative equity curve
  let peak = 0;
  let cumulative = 0;
  let maxDd = 0;
  for (const t of closed) {
    cumulative += t.pnl;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDd) maxDd = dd;
  }

  // Sharpe ratio (per-trade, simplified, no risk-free rate)
  const returns = closed.map((t) => t.pnl);
  const mean = returns.length ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const variance = returns.length
    ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
    : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(returns.length || 1) : 0;

  const pnls = closed.map((t) => t.pnl);

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: open.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    totalPnl,
    avgPnl: closed.length ? totalPnl / closed.length : 0,
    bestTrade: pnls.length ? Math.max(...pnls) : 0,
    worstTrade: pnls.length ? Math.min(...pnls) : 0,
    maxDrawdown: maxDd,
    maxDrawdownPct: peak > 0 ? (maxDd / peak) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    sharpeRatio: sharpe,
    cumulativePnl: totalPnl,
  };
}

export interface EquityPoint {
  label: string;
  date: string;
  value: number; // cumulative pnl
  pnl: number; // pnl of this trade
}

/** Builds a cumulative equity curve from closed trades, ordered by close time. */
export function buildEquityCurve(trades: Trade[]): EquityPoint[] {
  const closed = trades
    .filter((t) => t.status !== "open")
    .slice()
    .sort((a, b) => tradeDate(a).getTime() - tradeDate(b).getTime());

  let cumulative = 0;
  return closed.map((t, idx) => {
    cumulative += t.pnl;
    const d = tradeDate(t);
    return {
      label: `#${idx + 1}`,
      date: d.toISOString().slice(0, 10),
      value: cumulative,
      pnl: t.pnl,
    };
  });
}

export interface AssetSlice {
  symbol: string;
  value: number; // total notional / quote_qty
  trades: number;
  pnl: number;
}

/** Aggregates capital allocation per symbol for distribution charts. */
export function buildAssetDistribution(trades: Trade[]): AssetSlice[] {
  const map = new Map<string, AssetSlice>();
  for (const t of trades) {
    const existing = map.get(t.symbol) ?? {
      symbol: t.symbol,
      value: 0,
      trades: 0,
      pnl: 0,
    };
    existing.value += Math.abs(t.quote_qty);
    existing.trades += 1;
    existing.pnl += t.pnl;
    map.set(t.symbol, existing);
  }
  return Array.from(map.values()).sort((a, b) => b.value - a.value);
}

export interface SymbolPerformance {
  symbol: string;
  pnl: number;
  trades: number;
  winRate: number;
}

/** Per-symbol performance for the heatmap / best-worst lists. */
export function buildSymbolPerformance(trades: Trade[]): SymbolPerformance[] {
  const map = new Map<string, { pnl: number; trades: number; wins: number }>();
  for (const t of trades.filter((x) => x.status !== "open")) {
    const e = map.get(t.symbol) ?? { pnl: 0, trades: 0, wins: 0 };
    e.pnl += t.pnl;
    e.trades += 1;
    if (t.pnl > 0) e.wins += 1;
    map.set(t.symbol, e);
  }
  return Array.from(map.entries())
    .map(([symbol, v]) => ({
      symbol,
      pnl: v.pnl,
      trades: v.trades,
      winRate: v.trades ? (v.wins / v.trades) * 100 : 0,
    }))
    .sort((a, b) => b.pnl - a.pnl);
}

export function formatCurrency(value: number, fractionDigits = 2): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

export function formatPct(value: number, fractionDigits = 1): string {
  if (!isFinite(value)) return "∞";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(fractionDigits)}%`;
}
