import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError } from "@/lib/api";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { getBot } from "@/lib/quantAgent/botStore";
import { executeBotOrder } from "@/lib/quantAgent/bots/liveExecution";

/**
 * Place one order on behalf of a bot the caller owns.
 *
 * The only side-effecting path: executeBotOrder → createIntent → executeIntent.
 * A bot still in simulation returns 200 with ok:false and creates no intent.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z
  .object({
    side: z.enum(["buy", "sell"]),
    entry: z.number().finite().positive().optional().nullable(),
    stopLoss: z.number().finite().positive().optional().nullable(),
    takeProfit: z.number().finite().positive().optional().nullable(),
    rationale: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

function parseId(idParam: string): string {
  const id = idParam.trim();
  if (!id || id.length > 64) throw new ApiError(400, "Invalid bot id.");
  return id;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const { id: idParam } = await ctx.params;
    const id = parseId(idParam);
    const bot = await getBot(userId, id);
    if (!bot) throw new ApiError(404, "Bot not found.");
    const body = bodySchema.parse(await req.json());
    const result = await executeBotOrder({
      userId,
      bot,
      side: body.side,
      entry: body.entry ?? null,
      stopLoss: body.stopLoss ?? null,
      takeProfit: body.takeProfit ?? null,
      rationale: body.rationale ?? null,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 200 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
