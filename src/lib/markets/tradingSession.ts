/**
 * Which trading session a moment falls in.
 *
 * One definition, because there were two: `performanceJournal.ts` exported one
 * for the lessons feed and `caseFingerprint.ts` kept a private copy for the
 * case memory. They agreed — the same three boundaries, to the hour — which is
 * exactly why the duplication was invisible and exactly how it would have
 * stopped agreeing. A case indexed as "london" and a lesson filed as "newyork"
 * for the same timestamp is a disagreement no test would have caught, because
 * each module's tests only ever asked its own copy.
 *
 * The boundaries are UTC and deliberately coarse: they mark liquidity regimes,
 * not exchange opening bells, and gold trades across all of them.
 */
export type TradingSession = "asia" | "london" | "newyork";

export function sessionOf(timestamp: number): TradingSession {
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 7 && hour < 12) return "london";
  if (hour >= 12 && hour < 21) return "newyork";
  return "asia";
}
