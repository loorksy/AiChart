/**
 * Canonical Lonora subscription product — ONE paid plan, and ONE currency.
 *
 * There is no trial allowance any more. A new account is handed a signup
 * grant of CREDITS (the amount is a billing_plan row the admin sets) and
 * spends it at the ordinary prices; "Free" simply means an account that has
 * never subscribed. Prices and grant sizes are DATABASE rows (billing v3);
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

/**
 * `trial` is the historical name of the FREE state — an account that has
 * never subscribed. It is kept as the stored value (a live database uses
 * it) but carries no allowance: Free and Pro spend the same credits.
 */
export type PlanStatus = "trial" | "active" | "suspended" | "expired";

export type EntitlementSnapshot = {
  role: "user" | "admin";
  planStatus: PlanStatus;
  isAdmin: boolean;
  hasPaidAccess: boolean;
  expiresAt: string | null;
  /**
   * User-facing status label key — never expose resolver internals.
   * `free` = never subscribed (spends credits like anyone else);
   * `full` = live subscription; `blocked` = suspended or expired.
   */
  access: "admin" | "full" | "free" | "blocked";
};
