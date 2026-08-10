import { getExecutionEnvSnapshot, type ExecutionEnv } from "./executionEnv";
import { getMtAccountMeta } from "./store";
import { DEFAULT_MARKET, resolveActiveMarket } from "./marketPolicy";
import type { MarketType } from "./markets/types";

export interface AccountProfile {
  hasLeverage: boolean;
  leverage: number | null;
  marginMode: string | null;
  hasSpread: boolean;
  spreadPips: number | null;
  spreadPct: number | null;
  marketType: MarketType;
  platform: string;
  accountLogin: string | null;
  accountCurrency: string;
  accountType: "حقيقي" | "ديمو" | "—";
}

function accountTypeAr(env: ExecutionEnv | null): "حقيقي" | "ديمو" | "—" {
  if (env === "live") return "حقيقي";
  if (env === "demo") return "ديمو";
  return "—";
}

/**
 * The account's own live bid/ask retired with the MT5/MetaApi data
 * migration — market data (including spread) now comes exclusively from
 * the platform's OANDA feed, never from the user's broker account. A
 * broker-specific execution spread is no longer surfaced here; the
 * account-profile spread fields report absent rather than substituting a
 * different venue's number under a "your account" label.
 */
export async function buildAccountProfile(
  userId: number,
  _symbol?: string,
): Promise<AccountProfile> {
  const [envSnap, meta] = await Promise.all([
    getExecutionEnvSnapshot(userId),
    getMtAccountMeta(userId),
  ]);
  const market = resolveActiveMarket(DEFAULT_MARKET);
  const connected = Boolean(meta?.online);

  const spreadPips: number | null = null;
  const spreadPct: number | null = null;
  const hasSpread = false;

  return {
    hasLeverage: false,
    leverage: null,
    marginMode: null,
    hasSpread,
    spreadPips,
    spreadPct,
    marketType: market,
    platform: connected ? "MT5" : "—",
    accountLogin: meta?.login ? String(meta.login) : null,
    accountCurrency: meta?.currency ?? "USD",
    accountType: accountTypeAr(envSnap.forex.resolved),
  };
}

export function accountFooterLines(profile: AccountProfile): string[] {
  return [
    `المنصة: ${profile.platform}`,
    `الحساب: ${profile.accountLogin ?? "—"}`,
    `نوع الحساب: ${profile.accountType}`,
  ];
}
