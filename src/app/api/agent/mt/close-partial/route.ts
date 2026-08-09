import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { closePartiallyForUser } from "@/lib/brokers/tradeManagementDispatch";

const schema = z.object({
  ticket: z.number().int().positive(),
  lots: z.number().positive(),
  /** Preview only: confirms nothing is sent, without a numeric preview — see note. */
  dry_run: z.boolean().default(false),
});

/** Bridge: partial close, on whichever backend holds the position. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    if (body.dry_run) {
      // No broker-agnostic "read position by ticket" exists yet (tradeWatch.ts
      // deliberately stubs it — see the EA-bridge-removal work), so this cannot
      // show current position size or estimated PnL the way close_trade's
      // preview does. What IS guaranteed: nothing is sent to the broker below.
      return NextResponse.json({
        ok: true,
        dry_run: true,
        would_close_partial: { ticket: body.ticket, lots: body.lots },
        preview_available: false,
        reason:
          "no_position_lookup: this platform has no broker-agnostic way to read a position's current size by ticket yet, so the requested lots cannot be checked against it before sending. Nothing is sent to the broker for a dry_run call.",
      });
    }

    return NextResponse.json(
      await closePartiallyForUser(userId, { ticket: body.ticket, lots: body.lots }),
    );
  } catch (e) {
    return handleError(e);
  }
}
