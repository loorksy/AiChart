import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { getSignalEvent } from "@/lib/quantAgent/signalEventStore";

/**
 * One fired Quant Agent signal, with its per-channel delivery outcome.
 *
 * The handler resolves the row through the user-scoped store accessor, which
 * filters on `user_id` in SQL and re-asserts it on the returned row. An id in
 * the URL is never treated as authority to read: we closed an authz hole of
 * exactly that shape on the strategy-enable route, and a by-id handler that
 * trusts the path segment is the same bug wearing a different hat.
 *
 * Another tenant's id answers 404, not 403 — a check that distinguishes the
 * two leaks which ids exist.
 */

export const runtime = "nodejs";

function parseId(idParam: string): string {
  const id = idParam.trim();
  if (!id || id.length > 64) throw new ApiError(400, "Invalid signal id.");
  return id;
}

/** Read one signal event the caller owns. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const { id: idParam } = await ctx.params;
    const signal = await getSignalEvent(userId, parseId(idParam));
    if (!signal) throw new ApiError(404, "Signal not found.");
    return NextResponse.json({ signal });
  } catch (err) {
    return handleError(err);
  }
}
