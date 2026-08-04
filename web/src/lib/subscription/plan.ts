/**
 * Canonical Lonora subscription product — single paid plan.
 * Billing duration is administrator-controlled; do not fabricate /month or /year.
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
  /** Exactly three completed agent interactions for free trial accounts. */
  trialInteractions: 3,
} as const;

export type PlanStatus = "trial" | "active" | "suspended" | "expired";

export type EntitlementSnapshot = {
  role: "user" | "admin";
  planStatus: PlanStatus;
  isAdmin: boolean;
  hasPaidAccess: boolean;
  trialUsed: number;
  trialRemaining: number;
  trialLimit: number;
  expiresAt: string | null;
  /** User-facing status label key — never expose resolver internals. */
  access: "admin" | "full" | "trial" | "blocked";
};
