import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError } from "@/lib/api";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { getBot, setBotExecutionMode } from "@/lib/quantAgent/botStore";
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
    // Ownership first — same shape as delete/simulate. setBotExecutionMode
    // re-checks, but a path that never looks the bot up with the caller id is
    // the authz hole this surface's guard exists to catch.
    const existing = await getBot(userId, id);
    if (!existing) throw new ApiError(404, "Bot not found.");
    const body = bodySchema.parse(await req.json());
    const bot = await setBotExecutionMode(userId, existing.id, body.executionMode);
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
