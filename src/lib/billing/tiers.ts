/**
 * ONE subscription tier — a LEAF module, no imports.
 *
 * The four-tier table collapsed into the single $180/month Full Access plan
 * (the same product AICHART_PLAN describes; that module stays import-free of
 * this one so both remain leaves). Prices and included credits are PUBLIC
 * product facts. What is NOT here: the platform's cost margin — that lives in
 * platform_config (BILLING_RETAIL_MULTIPLIER), never in this public repo.
 *
 * Legacy tier ids (lite/plus/pro/promax) remain resolvable through
 * `tierDef()` so stored subscription rows and old Stripe metadata keep
 * working — they all map onto the one plan.
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
