/**
 * Multi-region Binance support. Binance operates several separate platforms;
 * an API key from one does NOT work on another. We let the user pick their
 * region so a key from ANY country connects, instead of forcing a global
 * account.
 *
 * - "standard" dialect = the classic Spot REST API (`/api/v3/*`, HMAC-SHA256,
 *   `X-MBX-APIKEY`). Used by Global (binance.com) and US (binance.us).
 * - "cloud-openv1" dialect = the Binance Cloud "Open API" (`/open/v1/*`),
 *   same HMAC-SHA256 + `X-MBX-APIKEY` auth but different endpoint paths and a
 *   `{ code, msg, data }` response envelope. Used by Binance.TR (Turkey).
 *
 * Auth/signing is identical across dialects (HMAC of the query string with the
 * secret, key in `X-MBX-APIKEY`), so only the base URL + endpoint paths +
 * response parsing differ per region.
 */
import type { BinanceEnv } from "./binance";

export type BinanceRegion = "global" | "us" | "tr";
export type BinanceDialect = "standard" | "cloud-openv1";

export interface BinanceRegionConfig {
  id: BinanceRegion;
  label: string;
  dialect: BinanceDialect;
  /** Signed/account base URL per env. Only "global" has a testnet. */
  signedBase: Partial<Record<BinanceEnv, string>>;
  /** Whether this region supports the testnet env. */
  envs: BinanceEnv[];
}

export const BINANCE_REGIONS: Record<BinanceRegion, BinanceRegionConfig> = {
  global: {
    id: "global",
    label: "عالمي (binance.com)",
    dialect: "standard",
    signedBase: {
      testnet: "https://testnet.binance.vision",
      prod: "https://api.binance.com",
    },
    envs: ["testnet", "prod"],
  },
  us: {
    id: "us",
    label: "أمريكي (binance.us)",
    dialect: "standard",
    signedBase: { prod: "https://api.binance.us" },
    envs: ["prod"],
  },
  tr: {
    id: "tr",
    label: "تركي (binance.tr)",
    dialect: "cloud-openv1",
    signedBase: { prod: "https://www.binance.tr" },
    envs: ["prod"],
  },
};

export function isBinanceRegion(v: unknown): v is BinanceRegion {
  return v === "global" || v === "us" || v === "tr";
}

export function regionConfig(region: BinanceRegion): BinanceRegionConfig {
  return BINANCE_REGIONS[region] ?? BINANCE_REGIONS.global;
}

/** Signed base URL for a region+env, falling back to the region's prod base. */
export function signedBaseFor(region: BinanceRegion, env: BinanceEnv): string {
  const cfg = regionConfig(region);
  return cfg.signedBase[env] ?? cfg.signedBase.prod ?? "https://api.binance.com";
}
