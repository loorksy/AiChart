import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError } from "@/lib/api";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { deleteBot, getBot, listBotRuns } from "@/lib/quantAgent/botStore";
import { getMtAccountMeta } from "@/lib/store";
import { mtModeToExecution, normalizeMtTradeMode } from "@/lib/executionEnv";

/**
 * One saved bot the caller owns — read it (with its recent simulation runs),
 * or delete it.
 *
 * BOTH handlers resolve the bot through `botStore`, which filters on the
 * caller's id in the service query AND re-asserts ownership on the decoded
 * record. An id in the URL is never authority on its own.
 *
 * Another tenant's id is a 404, not a 403 — distinguishing the two leaks which
 * ids exist.
 */

export const runtime = "nodejs";

function parseId(idParam: string): string {
  const id = idParam.trim();
  if (!id || id.length > 64) throw new ApiError(400, "Invalid bot id.");
  return id;
}

/** Read one bot the caller owns, plus its recent runs. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const { id: idParam } = await ctx.params;
    const id = parseId(idParam);
    const bot = await getBot(userId, id);
    if (!bot) throw new ApiError(404, "Bot not found.");
    const [runs, meta] = await Promise.all([
      listBotRuns(userId, id),
      getMtAccountMeta(userId).catch(() => null),
    ]);
    return NextResponse.json({
      bot,
      runs: runs ?? [],
      accountType: mtModeToExecution(normalizeMtTradeMode(meta?.account_trade_mode)),
    });
  } catch (err) {
    return handleError(err);
  }
}

/** Delete a bot the caller owns. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const { id: idParam } = await ctx.params;
    const id = parseId(idParam);
    // Ownership first: a delete that reached the service unscoped would be the
    // one call in this file that cannot be undone.
    const bot = await getBot(userId, id);
    if (!bot) throw new ApiError(404, "Bot not found.");
    const removed = await deleteBot(userId, id);
    if (!removed) throw new ApiError(404, "Bot not found.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
