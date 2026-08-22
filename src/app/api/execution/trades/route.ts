import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { resolveExecutionUserId } from "@/lib/execution/auth";
import { getExecutionTrades } from "@/lib/execution/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On-demand monitoring: open positions, closed results in money, and this
 * platform's own execution ledger. Read-only; nothing streams and nothing
 * here ever touches the recommendation record.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveExecutionUserId(req);
    const daysRaw = Number(req.nextUrl.searchParams.get("days"));
    const view = await getExecutionTrades({
      userId,
      days: Number.isFinite(daysRaw) ? daysRaw : undefined,
    });
    return NextResponse.json({
      linked: view.linked,
      refusal: view.refusal ?? null,
      open: view.open.map((p) => ({
        position_id: p.id,
        symbol: p.symbol,
        type: p.type,
        volume: p.volume,
        open_price: p.openPrice,
        stop_loss: p.stopLoss,
        take_profit: p.takeProfit,
        profit: p.profit,
        opened_at: p.time,
      })),
      closed: view.closed.map((t) => ({
        position_id: t.positionId,
        symbol: t.symbol,
        volume: t.volume,
        close_price: t.closePrice,
        net_profit: t.netProfit,
        closed_at: t.closedAt,
      })),
      closed_net_total: view.closedNetTotal,
      executions: view.executions.map((e) => ({
        id: e.id,
        recommendation_id: e.recommendation_id,
        state: e.state,
        direction: e.direction,
        volume: e.volume,
        executed_price: e.executed_price,
        slippage: e.slippage,
        error_code: e.error_code,
        created_at: e.created_at,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
