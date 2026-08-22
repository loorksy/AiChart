import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { resolveExecutionUserId } from "@/lib/execution/auth";
import { buildExecutionContext } from "@/lib/execution/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the execute button/modal may show for one recommendation — decided
 * SERVER-side: an unlinked account or a dead plan gets `executable:false`
 * with the short reason, and the suggested size comes precomputed from the
 * user's own risk setting and live account numbers.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveExecutionUserId(req);
    const recommendationId = req.nextUrl.searchParams.get("recommendation_id")?.trim();
    if (!recommendationId) {
      return NextResponse.json({ error: "recommendation_id required" }, { status: 400 });
    }
    const context = await buildExecutionContext(userId, recommendationId);
    return NextResponse.json({
      linked: context.linked,
      executable: context.executable,
      refusal: context.refusal ?? null,
      refusal_detail: context.refusalDetail ?? null,
      suggested_volume: context.suggestedVolume ?? null,
      min_volume: context.minVolume ?? null,
      max_volume: context.maxVolume ?? null,
      volume_step: context.volumeStep ?? null,
      balance: context.balance ?? null,
      currency: context.currency ?? null,
      risk_pct: context.riskPct ?? null,
      direction: context.direction ?? null,
      symbol: context.symbol ?? null,
      entry: context.entry ?? null,
      stop_loss: context.stopLoss ?? null,
      take_profit: context.takeProfit ?? null,
      expires_at: context.expiresAt ?? null,
      existing_execution: context.existingExecution
        ? {
            id: context.existingExecution.id,
            state: context.existingExecution.state,
            volume: context.existingExecution.volume,
            executed_price: context.existingExecution.executed_price,
          }
        : null,
    });
  } catch (err) {
    return handleError(err);
  }
}
