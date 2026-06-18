import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { requireEaConnection } from "@/lib/eaAuth";
import { updateEaLiveQuotes } from "@/lib/eaLiveState";

const schema = z.object({
  quotes: z
    .array(
      z.object({
        symbol: z.string().min(1),
        bid: z.number(),
        ask: z.number(),
        tick_time: z.number().optional(),
      }),
    )
    .min(1)
    .max(60),
});

/** EA v3 → server: lightweight live quote push (1–2s). */
export async function POST(req: NextRequest) {
  try {
    const conn = await requireEaConnection(req);
    const body = schema.parse(await req.json());
    await updateEaLiveQuotes(conn.user_id, body.quotes);
    return NextResponse.json({ ok: true, count: body.quotes.length });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.issues[0]?.message ?? "Invalid quotes payload." },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}
