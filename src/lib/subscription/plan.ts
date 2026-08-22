/**
 * Canonical Lonora subscription product — ONE paid plan plus a free trial
 * that carries EVERY feature and is bounded by the trial caps the ADMIN
 * sets (billing_plan: recommendation count, optional wall clock — disabled
 * by default). Prices and trial numbers are DATABASE rows (billing v3);
 * this module keeps only identity and contact facts.
 */

export const AICHART_PLAN = {
  id: "aichart_full_access",
  titleEn: "Lonora Full Access",
  titleAr: "Lonora — الوصول الكامل",
  currency: "USD",
  telegramHandle: "aswadtr",
  telegramUrl: "https://t.me/aswadtr",
} as const;

/** The admin-set trial bounds, resolved from billing_plan at read time. */
export interface TrialConfig {
  /** Recommendations the trial may create before it ends. */
  trialLimit: number;
  /** Wall-clock budget from the first start; 0 = no clock (the default). */
  trialDurationMs: number;
}

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
  /** When the trial clock started and when it dies. */
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
  expiresAt: string | null;
  /** User-facing status label key — never expose resolver internals. */
  access: "admin" | "full" | "trial" | "blocked";
};
