import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { listStrategyBacktests } from "@/lib/strategies/evidence";

/**
 * Owner-scoped backtest evidence feed for the visual backtest section.
 * Artifact IDs are internal — only headline metrics and breakdowns ship.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePaidAccess();
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 30);
    const backtests = await listStrategyBacktests(
      user.id,
      Number.isFinite(limit) ? limit : 30,
    );
    return NextResponse.json({
      backtests: backtests.map((b) => ({
        id: b.id,
        strategyId: b.strategyId,
        strategyVersion: b.strategyVersion,
        symbol: b.symbol,
        timeframe: b.timeframe,
        status: b.status,
        tradeCount: b.tradeCount,
        winRate: b.winRate,
        expectancy: b.expectancy,
        sharpeRatio: b.sharpeRatio,
        maxDrawdownPct: b.maxDrawdownPct,
        profitFactor: b.profitFactor,
        calibratedConfidence: b.calibratedConfidence,
        confidenceLow: b.confidenceLow,
        confidenceHigh: b.confidenceHigh,
        errorMessage: b.errorMessage,
        createdAt: b.createdAt,
        completedAt: b.completedAt,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
