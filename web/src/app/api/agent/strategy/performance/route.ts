import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { normalizeSymbol } from "@/lib/markets/symbolMapping";
import { BACKTEST_STRATEGY_IDS } from "@/lib/strategies/catalog";
import { getStrategyPerformance } from "@/lib/strategies/evidence";

const querySchema = z.object({
  strategy_id: z.enum(BACKTEST_STRATEGY_IDS),
  symbol: z.string().min(1).max(32).optional(),
  timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const parsed = querySchema.parse({
      strategy_id: req.nextUrl.searchParams.get("strategy_id"),
      symbol: req.nextUrl.searchParams.get("symbol") || undefined,
      timeframe: req.nextUrl.searchParams.get("timeframe") || undefined,
    });
    const result = await getStrategyPerformance({
      userId,
      strategyId: parsed.strategy_id,
      symbol: parsed.symbol ? normalizeSymbol(parsed.symbol).canonical : undefined,
      timeframe: parsed.timeframe,
      context: {
        userId,
        requestId: req.headers.get("x-request-id")?.trim() || randomUUID(),
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return handleError(error);
  }
}

