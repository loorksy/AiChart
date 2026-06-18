/** Per-symbol tick gap metrics for EA /api/ea/quotes ingestion. */

export const TICK_GAP_BUCKETS = [
  "0-1000",
  "1000-3000",
  "3000-5000",
  "5000-10000",
  "10000+",
] as const;

export type TickGapBucket = (typeof TICK_GAP_BUCKETS)[number];

export interface TickGapHistogram {
  "0-1000": number;
  "1000-3000": number;
  "3000-5000": number;
  "5000-10000": number;
  "10000+": number;
}

export interface SymbolTickMetrics {
  symbol: string;
  lastTickGapMs: number | null;
  recentGapsMs: number[];
  histogram: TickGapHistogram;
  totalUpdates: number;
}

const RECENT_GAPS_MAX = 20;

function emptyHistogram(): TickGapHistogram {
  return {
    "0-1000": 0,
    "1000-3000": 0,
    "3000-5000": 0,
    "5000-10000": 0,
    "10000+": 0,
  };
}

export function gapToBucket(gapMs: number): TickGapBucket {
  if (gapMs < 1000) return "0-1000";
  if (gapMs < 3000) return "1000-3000";
  if (gapMs < 5000) return "3000-5000";
  if (gapMs < 10000) return "5000-10000";
  return "10000+";
}

type UserMetrics = Map<string, SymbolTickMetrics>;

const metricsByUser = new Map<number, UserMetrics>();

function getOrCreateSymbolMetrics(
  userId: number,
  symbolKey: string,
  displaySymbol: string,
): SymbolTickMetrics {
  let userMap = metricsByUser.get(userId);
  if (!userMap) {
    userMap = new Map();
    metricsByUser.set(userId, userMap);
  }
  let m = userMap.get(symbolKey);
  if (!m) {
    m = {
      symbol: displaySymbol,
      lastTickGapMs: null,
      recentGapsMs: [],
      histogram: emptyHistogram(),
      totalUpdates: 0,
    };
    userMap.set(symbolKey, m);
  }
  return m;
}

/** Record gap since previous quote push for a symbol (server receive time). */
export function recordEaQuoteTickGap(
  userId: number,
  symbol: string,
  previousUpdatedAt: number | undefined,
  now = Date.now(),
): number | null {
  const sym = symbol.trim();
  if (!sym) return null;
  const key = sym.toUpperCase();
  const m = getOrCreateSymbolMetrics(userId, key, sym);

  let gapMs: number | null = null;
  if (previousUpdatedAt !== undefined) {
    gapMs = Math.max(0, now - previousUpdatedAt);
    m.lastTickGapMs = gapMs;
    m.histogram[gapToBucket(gapMs)] += 1;
    m.recentGapsMs.unshift(gapMs);
    if (m.recentGapsMs.length > RECENT_GAPS_MAX) {
      m.recentGapsMs.length = RECENT_GAPS_MAX;
    }
    if (process.env.EA_QUOTE_METRICS_LOG === "1") {
      console.info(
        `[ea-quotes] user=${userId} symbol=${sym} gapMs=${gapMs} total=${m.totalUpdates + 1}`,
      );
    }
  }

  m.totalUpdates += 1;
  return gapMs;
}

export function getEaQuoteTickMetrics(
  userId: number,
  symbol?: string,
): SymbolTickMetrics | SymbolTickMetrics[] | null {
  const userMap = metricsByUser.get(userId);
  if (!userMap) {
    if (symbol) return null;
    return [];
  }
  if (symbol) {
    const key = symbol.trim().toUpperCase();
    return userMap.get(key) ?? null;
  }
  return [...userMap.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** @internal tests only */
export function clearEaQuoteTickMetrics(userId?: number): void {
  if (userId === undefined) {
    metricsByUser.clear();
    return;
  }
  metricsByUser.delete(userId);
}
