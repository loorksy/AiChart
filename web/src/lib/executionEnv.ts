import { getEaConnection, isHeartbeatFresh } from "./eaStore";

import { DEFAULT_MARKET, resolveActiveMarket } from "./marketPolicy";

import { getSettings } from "./store";

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

  preference: ExecutionEnv;

  activeMarket: MarketType;

  forex: {

    connected: boolean;

    actual: MtAccountTradeMode;

    resolved: ExecutionEnv | null;

    online: boolean;

  };

  /** True when preference does not match the active market's actual account env. */

  mismatch: boolean;

  mismatchDetailAr: string | null;

}



export function normalizeMtTradeMode(raw: string | null | undefined): MtAccountTradeMode {

  const v = (raw ?? "").toLowerCase();

  if (v === "demo" || v === "live" || v === "contest") return v;

  return null;

}



export function mtModeToExecution(mode: MtAccountTradeMode): ExecutionEnv | null {

  if (mode === "demo" || mode === "contest") return "demo";

  if (mode === "live") return "live";

  return null;

}



export function parseEaPositions(json: string | null): EaBrokerPosition[] {

  if (!json) return [];

  try {

    const parsed = JSON.parse(json) as unknown;

    if (!Array.isArray(parsed)) return [];

    return parsed

      .map((p) => {

        const row = p as Record<string, unknown>;

        const side = String(row.side ?? "").toLowerCase();

        return {

          ticket: Number(row.ticket) || 0,

          symbol: String(row.symbol ?? "").toUpperCase(),

          side: side === "sell" ? "sell" : "buy",

          lots: Number(row.lots) || 0,

          open_price: Number(row.open_price) || 0,

          sl: row.sl != null ? Number(row.sl) : null,

          tp: row.tp != null ? Number(row.tp) : null,

          profit: Number(row.profit) || 0,

        } satisfies EaBrokerPosition;

      })

      .filter((p) => p.ticket > 0 && p.symbol);

  } catch {

    return [];

  }

}



function mismatchMessage(

  preference: ExecutionEnv,

  forexResolved: ExecutionEnv | null,

): string | null {

  if (!forexResolved) return "MetaTrader غير متصل أو نوع الحساب غير معروف.";

  if (forexResolved !== preference) {

    return preference === "demo"

      ? "حساب MT5 الحالي حقيقي — سجّل الدخول لحساب ديمو على التيرمينال."

      : "حساب MT5 الحالي ديمو — سجّل الدخول لحساب حقيقي على التيرمينال.";

  }

  return null;

}



export async function getExecutionEnvSnapshot(

  userId: number,

): Promise<ExecutionEnvSnapshot> {

  const settings = await getSettings(userId);

  const preference = (settings.execution_env_preference === "live"

    ? "live"

    : "demo") as ExecutionEnv;

  const activeMarket = resolveActiveMarket(settings.active_market ?? DEFAULT_MARKET);



  const eaConn = await getEaConnection(userId);

  const forexOnline =

    Boolean(eaConn) &&

    eaConn!.status !== "revoked" &&

    isHeartbeatFresh(eaConn!.last_heartbeat_at);

  const forexActual = normalizeMtTradeMode(eaConn?.account_trade_mode ?? null);

  const forexResolved = mtModeToExecution(forexActual);



  const mismatchDetailAr = mismatchMessage(preference, forexResolved);



  return {

    preference,

    activeMarket,

    forex: {

      connected: Boolean(eaConn && eaConn.status !== "revoked"),

      actual: forexActual,

      resolved: forexResolved,

      online: forexOnline,

    },

    mismatch: Boolean(mismatchDetailAr),

    mismatchDetailAr,

  };

}



/** Resolved env for the active market — used by Risk Guard. */

export async function getResolvedExecutionEnv(

  userId: number,

  _market?: MarketType,

): Promise<ExecutionEnv | null> {

  const snap = await getExecutionEnvSnapshot(userId);

  return snap.forex.resolved;

}



export function executionEnvLabelAr(env: ExecutionEnv | null): string {

  if (env === "demo") return "تجريبي (ديمو)";

  if (env === "live") return "حقيقي";

  return "غير معروف";

}


