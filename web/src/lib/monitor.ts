import { buildForexSnapshot, type MarketSnapshot } from "./market";

/**
 * Neutral market screening item for discovery paths.
 * Never contains BUY/SELL, entry, stop, targets, or trade confidence.
 */
export interface MarketScreeningItem {
  symbol: string;
  interval: string;
  /** Neutral activity/evidence labels — never directional trade advice. */
  neutralEvidence: string[];
  /** Non-directional activity score for shortlist ranking only. */
  activityScore: number;
  sourceHealth: "ok" | "degraded" | "unknown";
  quoteFreshnessMs: number | null;
  spread: number | null;
  volatilityActivityPct: number | null;
  candleCoverage: number | null;
  structuralActivity: string | null;
  neutralSummary: string;
  snapshot: MarketSnapshot;
}

/**
 * Direction-neutral activity screen used by live discovery paths. Scores only
 * data quality and movement magnitude; labels never recommend BUY or SELL.
 */
export function scoreNeutralScreening(
  snap: MarketSnapshot,
): MarketScreeningItem | null {
  const neutralEvidence: string[] = [];
  let activityScore = 0;
  let volatilityActivityPct: number | null = null;

  if (snap.rsi14 !== null && Math.abs(snap.rsi14 - 50) >= 15) {
    neutralEvidence.push(
      `RSI distance from neutral ${Math.abs(snap.rsi14 - 50).toFixed(1)}`,
    );
    activityScore += 1;
  }
  if (snap.macd && Math.abs(snap.macd.histogram) > 0) {
    neutralEvidence.push(
      `MACD momentum magnitude ${Math.abs(snap.macd.histogram).toPrecision(3)}`,
    );
    activityScore += 1;
  }
  if (snap.price > 0 && snap.atr14 != null) {
    const atrPct = (Math.abs(snap.atr14) / snap.price) * 100;
    volatilityActivityPct = atrPct;
    if (atrPct >= 0.03) {
      neutralEvidence.push(`ATR activity ${atrPct.toFixed(3)}%`);
      activityScore += 2;
    }
  }
  if (snap.price > 0 && snap.high24h > 0 && snap.low24h > 0) {
    const rangePct = (Math.abs(snap.high24h - snap.low24h) / snap.price) * 100;
    if (rangePct >= 0.15) {
      neutralEvidence.push(`24h range ${rangePct.toFixed(3)}%`);
      activityScore += 2;
    }
  }
  if (Math.abs(snap.change24hPct) >= 0.2) {
    neutralEvidence.push(
      `24h absolute movement ${Math.abs(snap.change24hPct).toFixed(2)}%`,
    );
    activityScore += 1;
  }
  if (activityScore < 2) return null;

  const structuralActivity =
    snap.trend === "sideways" ? "range_activity" : "trend_activity";

  return {
    symbol: snap.symbol,
    interval: snap.interval,
    neutralEvidence,
    activityScore,
    sourceHealth: "unknown",
    quoteFreshnessMs: null,
    spread: null,
    volatilityActivityPct,
    candleCoverage: null,
    structuralActivity,
    neutralSummary: snap.summary,
    snapshot: snap,
  };
}

export { parseAllowedAssets, isOpenAssetsPolicy } from "./allowedAssets";

/** Scans one forex symbol via MetaTrader / EA snapshot. */
export async function scanForexSymbol(
  userId: number,
  symbol: string,
  interval = "1h",
): Promise<MarketScreeningItem | null> {
  const snap = await buildForexSnapshot(userId, symbol, interval);
  return scoreNeutralScreening(snap);
}

export type ProximityKind = "sl" | "tp" | "entry";

export interface ProximityHit {
  kind: ProximityKind;
  level: number;
  current: number;
  distancePct: number;
}

function levelProximity(
  current: number,
  level: number | null | undefined,
  kind: ProximityKind,
  thresholdPct: number,
): ProximityHit | null {
  if (level == null || !Number.isFinite(level) || level <= 0) return null;
  if (!Number.isFinite(current) || current <= 0) return null;
  const distancePct = (Math.abs(current - level) / current) * 100;
  if (distancePct > thresholdPct) return null;
  return { kind, level, current, distancePct };
}

export function checkSlTpProximity(
  current: number,
  sl: number | null | undefined,
  tp: number | null | undefined,
  thresholdPct = 1.5,
): ProximityHit[] {
  const hits: ProximityHit[] = [];
  const slHit = levelProximity(current, sl, "sl", thresholdPct);
  if (slHit) hits.push(slHit);
  const tpHit = levelProximity(current, tp, "tp", thresholdPct);
  if (tpHit) hits.push(tpHit);
  return hits;
}
