/**
 * Session-aware spread (docs/UNIFIED_AGENT_PLAN.md §12).
 *
 * The backtest engine has always supported a per-session spread schedule, and
 * the catalog has always sent it a single fixed number — so every strategy was
 * validated against an Asian-session spread it never pays in London, or a
 * London spread that flatters the Asian range strategies. A scalp's edge lives
 * inside that difference.
 *
 * The schedule below is the shape of the cost curve, anchored to whatever spread
 * we actually observe. Rather than invent absolute numbers per session, each
 * session is expressed as a multiple of the observed one, so a wide-spread
 * broker and a tight one both get a realistic curve.
 */

export type ForexSession = "asia" | "london" | "new_york" | "london_new_york_overlap";

/**
 * Spread relative to the observed baseline, by session.
 *
 * Liquidity is deepest when London and New York overlap and thinnest in the
 * Asian session, and the ordering matters more than the exact multipliers:
 * a strategy that only works at Asian-session spreads should fail its own
 * backtest, not pass on a London number.
 */
export const SESSION_SPREAD_MULTIPLIER: Record<ForexSession, number> = {
  asia: 1.4,
  london: 1.0,
  new_york: 1.1,
  london_new_york_overlap: 0.9,
};

export interface SessionSpreadEntry {
  session: ForexSession;
  pips: number;
}

/**
 * Build the schedule the engine expects, from one observed spread.
 *
 * The observed value is treated as a London-session reading, which is where
 * most quotes are sampled and the most conservative anchor for the sessions
 * that are cheaper.
 */
export function buildSessionSpreadSchedule(observedPips: number): SessionSpreadEntry[] {
  const base = Math.max(0, observedPips);
  return (Object.keys(SESSION_SPREAD_MULTIPLIER) as ForexSession[]).map((session) => ({
    session,
    pips: Number((base * SESSION_SPREAD_MULTIPLIER[session]).toFixed(3)),
  }));
}

/** Which session a timestamp falls in, matching the engine's own definition. */
export function sessionAt(date: Date): ForexSession {
  const hour = date.getUTCHours();
  const london = hour >= 7 && hour < 16;
  const newYork = hour >= 12 && hour < 21;
  if (london && newYork) return "london_new_york_overlap";
  if (london) return "london";
  if (newYork) return "new_york";
  return "asia";
}

/**
 * The spread a plan should expect right now.
 *
 * Used in live analysis so "is this move worth its costs" is answered against
 * the session the trade would actually be taken in, not a daily average.
 */
export function expectedSpreadNow(observedPips: number, now = new Date()): {
  session: ForexSession;
  pips: number;
} {
  const session = sessionAt(now);
  return {
    session,
    pips: Number((Math.max(0, observedPips) * SESSION_SPREAD_MULTIPLIER[session]).toFixed(3)),
  };
}
