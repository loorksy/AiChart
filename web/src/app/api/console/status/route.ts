import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  getExecutionEnvSnapshot,
  executionEnvLabelAr,
} from "@/lib/executionEnv";
import { resolveBinanceFuturesOk } from "@/lib/consoleActiveTrades";
import { getSettings, getBinanceAccountMeta } from "@/lib/store";
import { getForexConnectionView } from "@/lib/forexConnection";

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const settings = await getSettings(user.id);
    const [binance, forex, executionEnv, futuresOk] = await Promise.all([
      getBinanceAccountMeta(user.id),
      getForexConnectionView(user.id),
      getExecutionEnvSnapshot(user.id),
      resolveBinanceFuturesOk(user.id, Boolean(settings.futures_enabled)),
    ]);

    const activeEnv =
      settings.active_market === "forex"
        ? executionEnv.forex.resolved
        : executionEnv.crypto.resolved;

    return NextResponse.json({
      binance: {
        connected: Boolean(binance),
        env: binance?.env ?? null,
        futuresOk,
      },
      mt5: {
        connected: forex.connected,
        online: forex.online,
      },
      telegram: {
        linked: Boolean(settings.telegram_chat_id),
      },
      executionEnv: {
        label: executionEnvLabelAr(activeEnv),
        mismatch: Boolean(executionEnv.mismatch),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
