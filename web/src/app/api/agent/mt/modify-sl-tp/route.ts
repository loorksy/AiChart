import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { modifyStopsForUser } from "@/lib/brokers/tradeManagementDispatch";

const schema = z.object({
  ticket: z.number().int().positive(),
  stop_loss: z.number().positive(),
  take_profit: z.number().positive().optional(),
  /** Preview only: confirms nothing is sent, without a numeric preview — see note. */
  dry_run: z.boolean().default(false),
});

/** Bridge: modify SL/TP on an open position, on whichever backend holds it. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    if (body.dry_run) {
      // No broker-agnostic "read position by ticket" exists yet (tradeWatch.ts
      // deliberately stubs it — see the EA-bridge-removal work), so this cannot
      // show current SL/TP or distance-to-price the way open_trade's preview
      // shows sizing. What IS guaranteed: nothing is sent to the broker below.
      return NextResponse.json({
        ok: true,
        dry_run: true,
        would_modify: { ticket: body.ticket, stop_loss: body.stop_loss, take_profit: body.take_profit ?? null },
        preview_available: false,
        reason:
          "no_position_lookup: this platform has no broker-agnostic way to read a position's current levels by ticket yet, so the requested values cannot be checked against them before sending. Nothing is sent to the broker for a dry_run call.",
      });
    }

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
