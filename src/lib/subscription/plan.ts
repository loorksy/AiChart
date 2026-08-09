/**
 * Canonical Lonora subscription product — ONE paid plan, billed monthly via
 * Stripe ($180/mo), plus a free trial that carries EVERY feature but is
 * bounded by two caps at once: a one-hour clock that starts at the user's
 * FIRST successful MetaTrader link, and three recommendations. Hitting either
 * cap ends the trial.
 */

export const AICHART_PLAN = {
  id: "aichart_full_access",
  titleEn: "Lonora Full Access",
  titleAr: "Lonora — الوصول الكامل",
  regularPriceUsd: 350,
  promotionalPriceUsd: 180,
  currency: "USD",
  telegramHandle: "aswadtr",
  telegramUrl: "https://t.me/aswadtr",
  /** Trial wall-clock budget, measured from the first successful MT link. */
  trialDurationMs: 60 * 60 * 1000,
  /** Recommendations the trial may create before it ends. */
  trialRecommendations: 3,
} as const;

export type PlanStatus = "trial" | "active" | "suspended" | "expired";

export type EntitlementSnapshot = {
  role: "user" | "admin";
  planStatus: PlanStatus;
  isAdmin: boolean;
  hasPaidAccess: boolean;
  /** Trial recommendations consumed / remaining / cap. */
  trialUsed: number;
  trialRemaining: number;
  trialLimit: number;
  /** When the trial clock started (first MT link) and when it dies. */
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
  expiresAt: string | null;
  /** User-facing status label key — never expose resolver internals. */
  access: "admin" | "full" | "trial" | "blocked";
};
