import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { getUnifiedSnapshot } from "@/lib/markets";

const MAX_INTERVALS = 5;

/**
 * Bridge: technical snapshots for several timeframes of one symbol in a single
 * call — fetched in parallel. Replaces the slow pattern of the agent calling
 * get_market_snapshot once per timeframe (serial round trips).
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    if (!symbol) {
      return NextResponse.json({ error: "symbol مطلوب." }, { status: 400 });
    }

    const intervals = (searchParams.get("intervals") ?? "1h,15m,5m")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_INTERVALS);
    if (intervals.length === 0) {
      return NextResponse.json(
        { error: "intervals مطلوبة (مثل 1h,15m,5m)." },
        { status: 400 },
      );
    }

    const rawMarket = searchParams.get("market") ?? DEFAULT_MARKET;
    const marketErr = rejectNonForexMarket(rawMarket);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }
    const market = resolveActiveMarket(rawMarket ?? DEFAULT_MARKET);

    const results = await Promise.all(
      intervals.map(async (interval) => {
        try {
          const snapshot = await getUnifiedSnapshot(
            symbol,
            market,
            interval,
            userId,
          );
          return { interval, snapshot };
        } catch (e) {
          return {
            interval,
            error: e instanceof Error ? e.message : "فشل جلب اللقطة.",
          };
        }
      }),
    );

    return NextResponse.json({ symbol, market, snapshots: results });
  } catch (e) {
    return handleError(e);
  }
}
