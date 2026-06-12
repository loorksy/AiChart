import { NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { cryptoMarketRank, smartMoneySignals } from "@/lib/binanceWeb3";

let flowCache: {
  at: number;
  payload: unknown;
} | null = null;

const CACHE_MS = 30_000;

/** Smart-money flow + market rank for whale bubbles (30s cache). */
export async function GET() {
  try {
    await requireUser();
    const now = Date.now();
    if (flowCache && now - flowCache.at < CACHE_MS) {
      return NextResponse.json({
        ok: true,
        cached: true,
        ...((flowCache.payload as object) ?? {}),
      });
    }

    const [signals, inflow] = await Promise.all([
      smartMoneySignals({ chainId: "56", pageSize: 40 }).catch(() => []),
      cryptoMarketRank("smart-money-inflow", { chainId: "56" }).catch(
        () => null,
      ),
    ]);

    const payload = {
      signals,
      inflow,
      updatedAt: new Date().toISOString(),
    };
    flowCache = { at: now, payload };

    return NextResponse.json({ ok: true, cached: false, ...payload });
  } catch (e) {
    return handleError(e);
  }
}
