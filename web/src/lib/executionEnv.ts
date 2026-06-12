import type { BinanceEnv } from "./binance";
import { getEaConnection, isHeartbeatFresh } from "./eaStore";
import {
  getBinanceCredentials,
  getSettings,
  listBinanceAccountMetas,
} from "./store";
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
  crypto: {
    connected: boolean;
    actual: BinanceEnv | null;
    resolved: ExecutionEnv | null;
    hasTestnet: boolean;
    hasProd: boolean;
  };
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

export function binanceEnvToExecution(env: BinanceEnv): ExecutionEnv {
  return env === "testnet" ? "demo" : "live";
}

export function executionToBinanceEnv(env: ExecutionEnv): BinanceEnv {
  return env === "demo" ? "testnet" : "prod";
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
  activeMarket: MarketType,
  preference: ExecutionEnv,
  cryptoResolved: ExecutionEnv | null,
  forexResolved: ExecutionEnv | null,
): string | null {
  if (activeMarket === "crypto") {
    if (!cryptoResolved) return "لا يوجد حساب Binance مرتبط للبيئة المطلوبة.";
    if (cryptoResolved !== preference) {
      return preference === "demo"
        ? "الحساب النشط على Binance حقيقي (prod) بينما التفضيل تجريبي — بدّل المفاتيح أو البيئة."
        : "الحساب النشط على Binance تجريبي (testnet) بينما التفضيل حقيقي.";
    }
    return null;
  }
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
  const activeMarket = settings.active_market ?? "crypto";

  const metas = await listBinanceAccountMetas(userId);
  const hasTestnet = metas.some((m) => m.env === "testnet");
  const hasProd = metas.some((m) => m.env === "prod");
  const targetBinance = executionToBinanceEnv(preference);
  const creds = await getBinanceCredentials(userId, targetBinance);
  const cryptoActual = creds?.env ?? null;
  const cryptoResolved = cryptoActual ? binanceEnvToExecution(cryptoActual) : null;

  const eaConn = await getEaConnection(userId);
  const forexOnline =
    Boolean(eaConn) &&
    eaConn!.status !== "revoked" &&
    isHeartbeatFresh(eaConn!.last_heartbeat_at);
  const forexActual = normalizeMtTradeMode(eaConn?.account_trade_mode ?? null);
  const forexResolved = mtModeToExecution(forexActual);

  const mismatchDetailAr = mismatchMessage(
    activeMarket,
    preference,
    cryptoResolved,
    forexResolved,
  );

  return {
    preference,
    activeMarket,
    crypto: {
      connected: Boolean(creds),
      actual: cryptoActual,
      resolved: cryptoResolved,
      hasTestnet,
      hasProd,
    },
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
  market?: MarketType,
): Promise<ExecutionEnv | null> {
  const snap = await getExecutionEnvSnapshot(userId);
  const m = market ?? snap.activeMarket;
  return m === "forex" ? snap.forex.resolved : snap.crypto.resolved;
}

export function executionEnvLabelAr(env: ExecutionEnv | null): string {
  if (env === "demo") return "تجريبي (ديمو)";
  if (env === "live") return "حقيقي";
  return "غير معروف";
}
