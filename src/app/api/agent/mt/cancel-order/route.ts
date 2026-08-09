import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { cancelOrderForUser } from "@/lib/brokers/tradeManagementDispatch";

const schema = z.object({
  ticket: z.number().int().positive(),
  /** Preview only: confirms nothing is sent, without a numeric preview — see note. */
  dry_run: z.boolean().default(false),
});

/** Bridge: cancel a pending order, on whichever backend holds it. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    if (body.dry_run) {
      // No broker-agnostic "read order by ticket" exists yet (tradeWatch.ts
      // deliberately stubs it — see the EA-bridge-removal work), so this cannot
      // confirm the order still exists or show its current state before sending.
      // What IS guaranteed: nothing is sent to the broker below.
      return NextResponse.json({
        ok: true,
        dry_run: true,
        would_cancel: { ticket: body.ticket },
        preview_available: false,
        reason:
          "no_position_lookup: this platform has no broker-agnostic way to read a pending order's current state by ticket yet, so its existence cannot be confirmed before sending. Nothing is sent to the broker for a dry_run call.",
      });
    }

    return NextResponse.json(await cancelOrderForUser(userId, { ticket: body.ticket }));
  } catch (e) {
    return handleError(e);
  }
}
