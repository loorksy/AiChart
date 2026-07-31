/**
 * V2-A2 (#91): the four subscription tiers — a LEAF module, no imports.
 *
 * Prices and included credits are PUBLIC product facts (they appear on the
 * pricing page). What is NOT here: the platform's cost margin — that lives in
 * platform_config (BILLING_RETAIL_MULTIPLIER), never in this public repo.
 */

export type TierId = "lite" | "plus" | "pro" | "promax";

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
    mt5Link: boolean;
    liveExecution: boolean;
    voice: boolean;
    scalpEngine: boolean;
    prioritySupport: boolean;
  };
}

export const TIERS: Record<TierId, TierDef> = {
  lite: {
    id: "lite",
    nameEn: "LITE",
    nameAr: "لايت",
    priceUsd: 79,
    includedCreditsUsd: 45,
    allowedModels: [
      "openai/gpt-5.6-luna",
      "anthropic/claude-haiku-4-5",
    ],
    features: {
      mt5Link: false,
      liveExecution: false,
      voice: false,
      scalpEngine: false,
      prioritySupport: false,
    },
  },
  plus: {
    id: "plus",
    nameEn: "PLUS",
    nameAr: "بلس",
    priceUsd: 149,
    includedCreditsUsd: 90,
    allowedModels: [
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-terra",
      "anthropic/claude-haiku-4-5",
      "anthropic/claude-sonnet-5",
    ],
    features: {
      mt5Link: true,
      liveExecution: false,
      voice: false,
      scalpEngine: false,
      prioritySupport: false,
    },
  },
  pro: {
    id: "pro",
    nameEn: "PRO",
    nameAr: "برو",
    priceUsd: 249,
    includedCreditsUsd: 160,
    allowedModels: [
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-sol",
      "anthropic/claude-haiku-4-5",
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-5",
      "anthropic/claude-opus-4-8",
    ],
    features: {
      mt5Link: true,
      liveExecution: true,
      voice: true,
      scalpEngine: true,
      prioritySupport: false,
    },
  },
  promax: {
    id: "promax",
    nameEn: "PRO MAX",
    nameAr: "برو ماكس",
    priceUsd: 399,
    includedCreditsUsd: 275,
    allowedModels: [],
    features: {
      mt5Link: true,
      liveExecution: true,
      voice: true,
      scalpEngine: true,
      prioritySupport: true,
    },
  },
};

export const TIER_ORDER: TierId[] = ["lite", "plus", "pro", "promax"];

export function tierDef(id: string | null | undefined): TierDef | null {
  if (!id) return null;
  return (TIERS as Record<string, TierDef>)[id] ?? null;
}

/** Is this model ref usable on the tier? Empty allowlist = everything. */
export function tierAllowsModel(tier: TierDef, modelRef: string): boolean {
  if (tier.allowedModels.length === 0) return true;
  return tier.allowedModels.includes(modelRef.toLowerCase());
}
