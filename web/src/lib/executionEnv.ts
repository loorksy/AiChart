import { getEaConnection, isHeartbeatFresh } from "./eaStore";
import { getMtAccountMeta, resolveForexBackendForUser } from "./store";
import type { MarketType } from "./markets/types";

export type ExecutionEnv = "demo" | "live";
export type MtAccountTradeMode = "demo" | "live" | "contest" | null;

export interface EaBrokerPosition {
  ticket: number;
  symbol: string;
  side: "buy" | "sell";
  lots: number;
  open_price: number;
  sl: number | null;
  tp: number | null;
  profit: number;
}

export interface ExecutionEnvSnapshot {
  activeMarket: MarketType;
  forex: { connected: boolean; actual: MtAccountTradeMode; resolved: ExecutionEnv | null; online: boolean };
}

export function normalizeMtTradeMode(raw: string | null | undefined): MtAccountTradeMode {
  // MetaApi reports the MT5 enum verbatim (ACCOUNT_TRADE_MODE_REAL); the EA
  // sends the bare word. Both mean the same account, so both must normalize to
  // the same value — a cloud account that reads as "unrecognised" is exactly
  // how a real-money connection slips past the live gate.
  const value = (raw ?? "").toLowerCase().replace(/^account_trade_mode_/, "").trim();
  // MT5's own enum calls a real-money account ACCOUNT_TRADE_MODE_REAL — an EA
  // reporting "real" IS a live account. Treating it as unrecognised (null) made
  // isRealMoneyExecution() false, so the live dual-enablement silently never
  // engaged for exactly the accounts it exists to protect.
  if (value === "real") return "live";
  return value === "demo" || value === "live" || value === "contest" ? value : null;
}

export function mtModeToExecution(mode: MtAccountTradeMode): ExecutionEnv | null {
  if (mode === "demo" || mode === "contest") return "demo";
  return mode === "live" ? "live" : null;
}

export function parseEaPositions(json: string | null): EaBrokerPosition[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => {
      const row = value as Record<string, unknown>;
      return {
        ticket: Number(row.ticket) || 0,
        symbol: String(row.symbol ?? "").toUpperCase(),
        side: String(row.side).toLowerCase() === "sell" ? "sell" as const : "buy" as const,
        lots: Number(row.lots) || 0,
        open_price: Number(row.open_price) || 0,
        sl: row.sl == null ? null : Number(row.sl),
        tp: row.tp == null ? null : Number(row.tp),
        profit: Number(row.profit) || 0,
      };
    }).filter((position) => position.ticket > 0 && position.symbol);
  } catch {
    return [];
  }
}

/**
 * Reports the broker's actual account type; there is no user env preference.
 *
 * Read from whichever backend the account is actually connected through. This
 * used to read the EA connection unconditionally, which meant a MetaApi or
 * MT5-bridge account — connected, funded and able to execute — always resolved
 * to `null`. Downstream that reads as "not real money", so the live
 * dual-enablement gate never engaged for cloud accounts, and the demo rollout
 * stage refused demo cloud accounts it should have allowed. Both followed from
 * asking the wrong connection.
 */
export async function getExecutionEnvSnapshot(userId: number): Promise<ExecutionEnvSnapshot> {
  const backend = await resolveForexBackendForUser(userId).catch(() => "ea" as const);

  if (backend !== "ea") {
    const meta = await getMtAccountMeta(userId).catch(() => null);
    const actual = normalizeMtTradeMode(meta?.account_trade_mode);
    return {
      activeMarket: "forex",
      forex: {
        connected: Boolean(meta),
        actual,
        resolved: mtModeToExecution(actual),
        online: Boolean(meta?.online),
      },
    };
  }

  const connection = await getEaConnection(userId);
  const connected = Boolean(connection && connection.status !== "revoked");
  const online = Boolean(connected && isHeartbeatFresh(connection?.last_heartbeat_at ?? null));
  const actual = normalizeMtTradeMode(connection?.account_trade_mode);
  return { activeMarket: "forex", forex: { connected, actual, resolved: mtModeToExecution(actual), online } };
}

export async function getResolvedExecutionEnv(userId: number, _market: MarketType): Promise<ExecutionEnv | null> {
  return (await getExecutionEnvSnapshot(userId)).forex.resolved;
}

export function executionEnvLabelAr(env: ExecutionEnv | null): string {
  return env === "live" ? "حقيقي" : env === "demo" ? "تجريبي" : "غير معروف";
}
