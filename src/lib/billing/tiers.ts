/**
 * LEGACY tier table — FROZEN analytics data, not product pricing.
 *
 * Billing v3 moved every live price into the database (billing_plan /
 * plan_prices / credit_prices / topup_packs): nothing here prices, charges,
 * or displays the product anymore. What remains is the historical mapping
 * the USD-era analytics read (profit dashboard revenue estimates over old
 * subscription rows) and `tierDef()` so legacy tier ids in stored rows and
 * old Stripe metadata keep resolving. Do not wire NEW code to these numbers.
 */

export type TierId = "full";

export interface TierDef {
  id: TierId;
  nameEn: string;
  nameAr: string;
  priceUsd: number;
  /** Monthly included credits, in retail USD. Reset each period, no rollover. */
  includedCreditsUsd: number;
  /** Model refs allowed ("provider/model"); empty = all catalogue models. */
  allowedModels: string[];
  features: {
    telegramBot: boolean;
    trackedRecommendations: boolean;
    voice: boolean;
    scalpEngine: boolean;
    prioritySupport: boolean;
  };
}

export const TIERS: Record<TierId, TierDef> = {
  full: {
    id: "full",
    nameEn: "Full Access",
    nameAr: "الوصول الكامل",
    priceUsd: 180,
    includedCreditsUsd: 120,
    // Empty = the whole curated model catalogue.
    allowedModels: [],
    features: {
      telegramBot: true,
      trackedRecommendations: true,
      voice: true,
      scalpEngine: true,
      prioritySupport: true,
    },
  },
};

export const TIER_ORDER: TierId[] = ["full"];

/** Stored rows / Stripe metadata written under the old four-tier table. */
const LEGACY_TIER_IDS = new Set(["lite", "plus", "pro", "promax"]);

export function tierDef(id: string | null | undefined): TierDef | null {
  if (!id) return null;
  if (id === "full") return TIERS.full;
  // Every legacy tier resolves to the one plan — renewals and admin panels
  // keep working for rows written before the collapse.
  if (LEGACY_TIER_IDS.has(id)) return TIERS.full;
  return null;
}

export function tierAllowsModel(id: string, modelRef: string): boolean {
  const def = tierDef(id);
  if (!def) return false;
  if (def.allowedModels.length === 0) return true;
  return def.allowedModels.includes(modelRef);
}
