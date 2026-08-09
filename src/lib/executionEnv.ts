import { getMtAccountMeta } from "./store";
import type { MarketType } from "./markets/types";

export type ExecutionEnv = "demo" | "live";
export type MtAccountTradeMode = "demo" | "live" | "contest" | null;

export interface ExecutionEnvSnapshot {
  activeMarket: MarketType;
  forex: { connected: boolean; actual: MtAccountTradeMode; resolved: ExecutionEnv | null; online: boolean };
}

export function normalizeMtTradeMode(raw: string | null | undefined): MtAccountTradeMode {
  // MetaApi reports the MT5 enum verbatim (ACCOUNT_TRADE_MODE_REAL); a
  // self-hosted bridge may send the bare word. Both mean the same account, so
  // both must normalize to the same value — a cloud account that reads as
  // "unrecognised" is exactly how a real-money connection slips past the live
  // gate.
  const value = (raw ?? "").toLowerCase().replace(/^account_trade_mode_/, "").trim();
  // MT5's own enum calls a real-money account ACCOUNT_TRADE_MODE_REAL — a
  // bridge reporting "real" IS a live account. Treating it as unrecognised
  // (null) made isRealMoneyExecution() false, so the live dual-enablement
  // silently never engaged for exactly the accounts it exists to protect.
  if (value === "real") return "live";
  return value === "demo" || value === "live" || value === "contest" ? value : null;
}

export function mtModeToExecution(mode: MtAccountTradeMode): ExecutionEnv | null {
  if (mode === "demo" || mode === "contest") return "demo";
  return mode === "live" ? "live" : null;
}


/** Reports the broker's actual account type; there is no user env preference. */
export async function getExecutionEnvSnapshot(userId: number): Promise<ExecutionEnvSnapshot> {
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

export async function getResolvedExecutionEnv(userId: number, _market: MarketType): Promise<ExecutionEnv | null> {
  return (await getExecutionEnvSnapshot(userId)).forex.resolved;
}

export function executionEnvLabelAr(env: ExecutionEnv | null): string {
  return env === "live" ? "حقيقي" : env === "demo" ? "تجريبي" : "غير معروف";
}
