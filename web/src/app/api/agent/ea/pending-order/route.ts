import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { queueEaCommandAndWait } from "@/lib/eaAgentCommands";
import { resolveMt5Symbol } from "@/lib/mt5SymbolMap";

const schema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  order_type: z.enum(["limit", "stop", "stop_limit"]),
  lots: z.number().positive(),
  price: z.number().positive(),
  stop_loss: z.number().positive().optional(),
  take_profit: z.number().positive().optional(),
});

/** Bridge: queue MT5 pending order via EA. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const mt5Symbol = (await resolveMt5Symbol(userId, body.symbol)) ?? body.symbol;

    const ack = await queueEaCommandAndWait(userId, "open_pending", {
      symbol: mt5Symbol,
      side: body.side,
      order_type: body.order_type,
      lots: body.lots,
      price: body.price,
      stop_loss: body.stop_loss ?? 0,
      take_profit: body.take_profit ?? 0,
    });

    return NextResponse.json({
      ok: ack.ok,
      command_id: ack.command.id,
      result: ack.result,
      reason: ack.reason,
    });
  } catch (e) {
    return handleError(e);
  }
}
