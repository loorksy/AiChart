import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError, ApiError } from "@/lib/api";
import { getBotSession, stopBotSession } from "@/lib/botStore";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePlatformAccess();
    const { id } = await ctx.params;
    const bot = await getBotSession(Number(id), user.id);
    if (!bot) throw new ApiError(404, "البوت غير موجود.");
    return NextResponse.json({ bot });
  } catch (err) {
    return handleError(err);
  }
}

/** Stop a bot (soft): halts new orders. Open paper levels remain in state. */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePlatformAccess();
    const { id } = await ctx.params;
    const bot = await getBotSession(Number(id), user.id);
    if (!bot) throw new ApiError(404, "البوت غير موجود.");
    await stopBotSession(bot.id, "stopped_by_user", user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
