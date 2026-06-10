import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { closeAllOpenTrades, closeOpenTrade } from "@/lib/tradeClose";

const schema = z
  .object({
    trade_id: z.number().int().positive().optional(),
    all: z.boolean().default(false),
  })
  .refine((b) => b.all || b.trade_id != null, {
    message: "حدّد trade_id أو all=true.",
  });

/** Bridge: closes one open trade (or all of them) and reports realized PnL. */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const body = schema.parse(await req.json());

    if (body.all) {
      const result = await closeAllOpenTrades(userId);
      return NextResponse.json({ ok: result.failed === 0, ...result });
    }

    const result = await closeOpenTrade(userId, body.trade_id as number);
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
