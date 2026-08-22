import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { resolveExecutionUserId } from "@/lib/execution/auth";
import { executeRecommendation, type ExecutionRefusalCode } from "@/lib/execution/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    recommendation_id: z.string().min(1).max(64),
    volume: z.number().positive().max(1000),
    /** One key per modal open — the double-click barrier's client half. */
    idempotency_key: z.string().min(8).max(80),
  })
  .strict();

/** HTTP status per refusal — the message stays one short factual line. */
const REFUSAL_STATUS: Partial<Record<ExecutionRefusalCode, number>> = {
  not_linked: 403,
  metaapi_unconfigured: 503,
  recommendation_not_found: 404,
  recommendation_closed: 409,
  recommendation_expired: 409,
  awaiting_activation: 409,
  plan_blocked: 409,
  missing_stop: 409,
  invalid_volume: 400,
  insufficient_margin: 400,
  already_executed: 409,
  send_unconfirmed: 502,
  metaapi_auth: 503,
  metaapi_error: 502,
};

function publicExecution(row: {
  id: number;
  state: string;
  volume: number;
  direction: string;
  symbol: string;
  stop_loss: number;
  take_profit: number | null;
  requested_price: number | null;
  executed_price: number | null;
  slippage: number | null;
  broker_position_id: string | null;
}) {
  return {
    id: row.id,
    state: row.state,
    symbol: row.symbol,
    direction: row.direction,
    volume: row.volume,
    stop_loss: row.stop_loss,
    take_profit: row.take_profit,
    requested_price: row.requested_price,
    executed_price: row.executed_price,
    slippage: row.slippage,
    broker_position_id: row.broker_position_id,
  };
}

/**
 * The press. Every guard is server-side: linked account, plan validity,
 * broker-grid volume, free margin, idempotency, one live order per plan.
 * The stop loss travels inside the order request itself.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveExecutionUserId(req);
    const body = schema.parse(await req.json());
    const result = await executeRecommendation({
      userId,
      recommendationId: body.recommendation_id,
      volume: body.volume,
      idempotencyKey: body.idempotency_key,
    });
    if (result.ok) {
      return NextResponse.json({ ok: true, execution: publicExecution(result.execution) });
    }
    return NextResponse.json(
      {
        ok: false,
        code: result.code,
        detail: result.detail ?? null,
        execution: result.execution ? publicExecution(result.execution) : null,
      },
      { status: REFUSAL_STATUS[result.code] ?? 400 },
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    return handleError(err);
  }
}
