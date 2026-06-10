import { buildSnapshot, buildForexSnapshot, type MarketSnapshot } from "./market";
import type { TradingSettings } from "./types";

export interface OpportunityCandidate {
  symbol: string;
  interval: string;
  signals: string[];
  score: number;
  snapshot: MarketSnapshot;
}

function thresholdForStyle(style: TradingSettings["style"]): number {
  if (style === "conservative") return 3;
  if (style === "balanced") return 2;
  return 1;
}

/**
 * Cheap 24/7 monitoring layer — pure code, no LLM. Returns a candidate
 * only when multiple technical signals align (per the user's style).
 */
export function scoreOpportunity(
  snap: MarketSnapshot,
  style: TradingSettings["style"],
): OpportunityCandidate | null {
  const signals: string[] = [];
  let score = 0;

  if (snap.rsi14 !== null) {
    if (snap.rsi14 <= 30) {
      signals.push(`RSI ${snap.rsi14.toFixed(1)} تشبّع بيعي`);
      score += 2;
    } else if (snap.rsi14 >= 70) {
      signals.push(`RSI ${snap.rsi14.toFixed(1)} تشبّع شرائي`);
      score += 2;
    }
  }

  if (snap.macd) {
    if (snap.macd.histogram > 0 && snap.macd.macd > snap.macd.signal) {
      signals.push("MACD صعودي");
      score += 1;
    } else if (snap.macd.histogram < 0 && snap.macd.macd < snap.macd.signal) {
      signals.push("MACD هبوطي");
      score += 1;
    }
  }

  if (snap.trend === "uptrend" && snap.rsi14 !== null && snap.rsi14 < 45) {
    signals.push("اتجاه صاعد مع تصحيح");
    score += 1;
  }
  if (snap.trend === "downtrend" && snap.rsi14 !== null && snap.rsi14 > 55) {
    signals.push("اتجاه هابط مع ارتداد");
    score += 1;
  }

  if (Math.abs(snap.change24hPct) >= 5) {
    signals.push(`تغيّر 24س ${snap.change24hPct.toFixed(1)}%`);
    score += 1;
  }

  if (score < thresholdForStyle(style)) return null;

  return {
    symbol: snap.symbol,
    interval: snap.interval,
    signals,
    score,
    snapshot: snap,
  };
}

export { parseAllowedAssets, isOpenAssetsPolicy } from "./allowedAssets";

/** Scans one crypto symbol and returns an opportunity candidate if signals align. */
export async function scanSymbol(
  symbol: string,
  style: TradingSettings["style"],
  interval = "1h",
): Promise<OpportunityCandidate | null> {
  const snap = await buildSnapshot(symbol, interval, "prod");
  return scoreOpportunity(snap, style);
}

/** Scans one forex symbol via MetaTrader / EA snapshot. */
export async function scanForexSymbol(
  userId: number,
  symbol: string,
  style: TradingSettings["style"],
  interval = "1h",
): Promise<OpportunityCandidate | null> {
  const snap = await buildForexSnapshot(userId, symbol, interval);
  return scoreOpportunity(snap, style);
}
