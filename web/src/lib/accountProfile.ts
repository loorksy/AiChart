import { getExecutionEnvSnapshot, type ExecutionEnv } from "./executionEnv";
import { getMtAccount, getMtAccountMeta } from "./store";
import { getRpcConnection } from "./metaapi/client";
import { DEFAULT_MARKET, resolveActiveMarket } from "./marketPolicy";
import type { MarketType } from "./markets/types";
import { spreadFromBidAsk } from "./spread";

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

/** The account's own bid/ask for its symbol — what an order actually crosses. */
async function cloudSpread(
  userId: number,
  symbol: string,
): Promise<{ spreadPips: number; spreadPct: number } | null> {
  const account = await getMtAccount(userId);
  if (!account?.metaapi_account_id || account.metaapi_account_id === "mt5local") {
    return null;
  }
  try {
    const rpc = await getRpcConnection(userId, account.metaapi_account_id);
    const price = await rpc.getSymbolPrice(symbol, true);
    const bid = Number(price?.bid);
    const ask = Number(price?.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
    const spread = spreadFromBidAsk(bid, ask, symbol);
    if (!spread) return null;
    return {
      spreadPips: Math.round(spread.spreadPips * 10) / 10,
      spreadPct: Math.round(spread.spreadPct * 1000) / 1000,
    };
  } catch {
    return null;
  }
}

export async function buildAccountProfile(
  userId: number,
  symbol?: string,
): Promise<AccountProfile> {
  const [envSnap, meta] = await Promise.all([
    getExecutionEnvSnapshot(userId),
    getMtAccountMeta(userId),
  ]);
  const market = resolveActiveMarket(DEFAULT_MARKET);
  const connected = Boolean(meta?.online);

  let spreadPips: number | null = null;
  let spreadPct: number | null = null;
  let hasSpread = false;

  if (symbol && connected) {
    const spread = await cloudSpread(userId, symbol);
    if (spread) {
      hasSpread = true;
      spreadPips = spread.spreadPips;
      spreadPct = spread.spreadPct;
    }
  }

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
