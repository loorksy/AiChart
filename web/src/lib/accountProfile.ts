import { getEaConnection, isHeartbeatFresh, parseEaSymbolSpecs } from "./eaStore";
import { getExecutionEnvSnapshot, type ExecutionEnv } from "./executionEnv";
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

function platformLabel(
  eaPlatform: string | null,
  connected: boolean,
): string {
  if (!connected) return "—";
  return eaPlatform?.toUpperCase() === "MT4" ? "MT4" : "MT5";
}

export async function buildAccountProfile(
  userId: number,
  symbol?: string,
): Promise<AccountProfile> {
  const envSnap = await getExecutionEnvSnapshot(userId);
  const market = resolveActiveMarket(DEFAULT_MARKET);
  const eaConn = await getEaConnection(userId);
  const forexOnline =
    Boolean(eaConn) &&
    eaConn!.status !== "revoked" &&
    isHeartbeatFresh(eaConn!.last_heartbeat_at);

  const resolved = envSnap.forex.resolved;
  const connected = forexOnline;

  let spreadPips: number | null = null;
  let spreadPct: number | null = null;
  let hasSpread = false;

  if (symbol && eaConn && forexOnline) {
    const spec = parseEaSymbolSpecs(eaConn.symbol_specs_json).find(
      (s) => s.symbol?.toUpperCase() === symbol.toUpperCase(),
    );
    if (spec) {
      const bid = Number(spec.bid) || 0;
      const ask = Number(spec.ask) || 0;
      const spread = spreadFromBidAsk(bid, ask, symbol);
      if (spread) {
        hasSpread = true;
        spreadPips = Math.round(spread.spreadPips * 10) / 10;
        spreadPct = Math.round(spread.spreadPct * 1000) / 1000;
      }
    }
  }

  const futuresEnabled = false;
  const leverage = null;

  return {
    hasLeverage: false,
    leverage,
    marginMode: null,
    hasSpread,
    spreadPips,
    spreadPct,
    marketType: market,
    platform: platformLabel(eaConn?.platform ?? null, connected),
    accountLogin:
      eaConn?.account_login ? String(eaConn.account_login) : null,
    accountCurrency: eaConn?.account_currency ?? "USD",
    accountType: accountTypeAr(resolved),
  };
}

export function accountFooterLines(profile: AccountProfile): string[] {
  return [
    `المنصة: ${profile.platform}`,
    `الحساب: ${profile.accountLogin ?? "—"}`,
    `نوع الحساب: ${profile.accountType}`,
  ];
}
