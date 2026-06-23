import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { createBotSession, listUserBots } from "@/lib/botStore";

export const dynamic = "force-dynamic";

// Strict bounds: Martingale is dangerous, so the server caps depth and
// multiplier regardless of what the client requests.
const schema = z.object({
  strategy: z.literal("grid").default("grid"),
  symbol: z.string().min(2).max(20),
  market: z.enum(["crypto", "forex"]).default("forex"),
  side: z.enum(["buy", "sell"]),
  executionMode: z.enum(["paper", "live"]).default("paper"),
  config: z.object({
    initialLot: z.number().positive().max(100),
    gridStep: z.number().positive(),
    multiplier: z.number().min(1).max(3),
    takeProfit: z.number().positive(),
    maxLevels: z.number().int().min(1).max(20),
    maxTotalLot: z.number().positive().max(1000),
    lotStep: z.number().positive().optional(),
  }),
});

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    return NextResponse.json({ bots: await listUserBots(user.id) });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const input = schema.parse(await req.json());
    const bot = await createBotSession(user.id, {
      strategy: input.strategy,
      symbol: input.symbol.toUpperCase(),
      market: input.market,
      side: input.side,
      executionMode: input.executionMode,
      config: { side: input.side, ...input.config },
    });
    return NextResponse.json({ ok: true, bot });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "إعدادات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
