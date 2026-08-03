import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { modifyStopsForUser } from "@/lib/brokers/tradeManagementDispatch";

const schema = z.object({
  ticket: z.number().int().positive(),
  stop_loss: z.number().positive(),
  take_profit: z.number().positive().optional(),
});

/** Bridge: modify SL/TP on an open position, on whichever backend holds it. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    return NextResponse.json(
      await modifyStopsForUser(userId, {
        ticket: body.ticket,
        stopLoss: body.stop_loss,
        takeProfit: body.take_profit,
      }),
    );
  } catch (e) {
    return handleError(e);
  }
}
