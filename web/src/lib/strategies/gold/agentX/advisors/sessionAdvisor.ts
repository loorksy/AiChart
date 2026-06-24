/**
 * Session Advisor — Asian/London/NY/overlap quality.
 */
import type { AdvisorVote, MarketContext, RegimeInfo, SessionInfo, TradingSession } from "../types";
import { clampScore } from "../types";

export function resolveSessionInfo(nowMs: number): SessionInfo {
  const d = new Date(nowMs);
  const h = d.getUTCHours();

  let session: TradingSession = "OFF_HOURS";
  let quality = 40;

  if (h >= 0 && h < 7) {
    session = "ASIAN";
    quality = 45;
  } else if (h >= 7 && h < 12) {
    session = "LONDON";
    quality = 75;
  } else if (h >= 12 && h < 16) {
    session = "LONDON_NY_OVERLAP";
    quality = 85;
  } else if (h >= 16 && h < 21) {
    session = "NEW_YORK";
    quality = 70;
  }

  return { session, quality, utcHour: h };
}

export function sessionWeightModifier(session: TradingSession): number {
  switch (session) {
    case "LONDON":
    case "LONDON_NY_OVERLAP":
      return 1.2;
    case "NEW_YORK":
      return 1.1;
    case "ASIAN":
      return 0.85;
    default:
      return 0.9;
  }
}

export function runSessionAdvisor(ctx: MarketContext, regime: RegimeInfo): AdvisorVote {
  const { session, quality } = ctx.session;
  const mod = sessionWeightModifier(session);

  let vote: AdvisorVote["vote"] = "hold";
  if (regime.dominant === "TRENDING_UP") vote = "buy";
  else if (regime.dominant === "TRENDING_DOWN") vote = "sell";

  if (session === "ASIAN" && regime.dominant === "RANGE") {
    return {
      advisor: "session",
      vote: "hold",
      confidence: clampScore(quality * mod * 0.8),
      reason: "جلسة آسيا — نطاق ضعيف",
    };
  }

  if (session === "LONDON" || session === "LONDON_NY_OVERLAP") {
    return {
      advisor: "session",
      vote,
      confidence: clampScore(quality * mod * 0.9),
      reason: `جلسة ${session} — جودة حركة ${quality}`,
    };
  }

  return {
    advisor: "session",
    vote,
    confidence: clampScore(quality * mod * 0.85),
    reason: `جلسة ${session}`,
  };
}
