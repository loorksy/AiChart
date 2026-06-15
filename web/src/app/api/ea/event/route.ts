import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { requireEaConnection } from "@/lib/eaAuth";
import { pushEaEvent } from "@/lib/eaLiveState";

const schema = z.object({
  type: z.string().min(1),
  symbol: z.string().optional(),
  deal_id: z.number().optional(),
  time: z.number().optional(),
}).passthrough();

/** EA v3 → server: immediate trade/account events. */
export async function POST(req: NextRequest) {
  try {
    const conn = await requireEaConnection(req);
    const body = schema.parse(await req.json());
    pushEaEvent(conn.user_id, {
      type: body.type,
      symbol: body.symbol,
      dealId: body.deal_id,
      payload: body as Record<string, unknown>,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.issues[0]?.message ?? "Invalid event payload." },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}
