import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { cancelOrderForUser } from "@/lib/brokers/tradeManagementDispatch";

const schema = z.object({
  ticket: z.number().int().positive(),
});

/** Bridge: cancel a pending order, on whichever backend holds it. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    return NextResponse.json(await cancelOrderForUser(userId, { ticket: body.ticket }));
  } catch (e) {
    return handleError(e);
  }
}
