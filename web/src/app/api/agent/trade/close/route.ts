import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { closeAllOpenTrades, closeOpenTrade } from "@/lib/tradeClose";
import { logAudit } from "@/lib/store";

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
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    if (body.all) {
      const result = await closeAllOpenTrades(userId);
      await logAudit(
        userId,
        "agent_trade_close",
        `all: closed ${result.closed}, pnl ${result.totalPnl.toFixed(2)} USD`,
      );
      return NextResponse.json({ ok: result.failed === 0, ...result });
    }

    const result = await closeOpenTrade(userId, body.trade_id as number);
    await logAudit(
      userId,
      "agent_trade_close",
      `#${body.trade_id} ${result.symbol}: ${result.ok ? `pnl ${result.pnl.toFixed(2)} USD` : result.reason}`,
    );
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
