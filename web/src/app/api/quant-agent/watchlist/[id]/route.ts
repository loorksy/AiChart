import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { removeFromWatchlist } from "@/lib/quantAgent/watchlistStore";

/** Remove a watchlist row the user owns (plan §A6). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid watchlist item id.");
    const ok = await removeFromWatchlist(userId, id);
    if (!ok) throw new ApiError(404, "Watchlist item not found.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
