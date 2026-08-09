import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError } from "@/lib/api";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { setBotExecutionMode } from "@/lib/quantAgent/botStore";
import { QUANT_BOT_EXECUTION_MODES } from "@/lib/quantAgent/bots/brokerPort";
import { logAudit } from "@/lib/store";

/**
 * Owner-only arming switch for one bot: `simulation` ↔ `live`.
 *
 * This does not place an order. Moving a bot to `live` is consent for that
 * bot to create intents later; every order still goes through executeIntent.
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({
    executionMode: z.enum(QUANT_BOT_EXECUTION_MODES as unknown as ["simulation", "live"]),
  })
  .strict();

function parseId(idParam: string): string {
  const id = idParam.trim();
  if (!id || id.length > 64) throw new ApiError(400, "Invalid bot id.");
  return id;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const { id: idParam } = await ctx.params;
    const id = parseId(idParam);
    const body = bodySchema.parse(await req.json());
    const bot = await setBotExecutionMode(userId, id, body.executionMode);
    if (!bot) throw new ApiError(404, "Bot not found.");
    await logAudit(
      userId,
      "quant_bot_execution_mode",
      JSON.stringify({ botId: bot.id, executionMode: bot.executionMode }),
    ).catch(() => undefined);
    return NextResponse.json({ bot });
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
