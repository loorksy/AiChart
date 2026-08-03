import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { closePartiallyForUser } from "@/lib/brokers/tradeManagementDispatch";

const schema = z.object({
  ticket: z.number().int().positive(),
  lots: z.number().positive(),
});

/** Bridge: partial close, on whichever backend holds the position. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    return NextResponse.json(
      await closePartiallyForUser(userId, { ticket: body.ticket, lots: body.lots }),
    );
  } catch (e) {
    return handleError(e);
  }
}
