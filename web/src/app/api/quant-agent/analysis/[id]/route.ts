import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { deleteQuantAnalysis, getQuantAnalysis } from "@/lib/quantAgent/analysisStore";

/**
 * One stored Quant Agent analysis — read it, or delete it.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/routes/fast_analysis.py`
 * (`DELETE /history/<memory_id>`). What changed: upstream has no by-id READ at
 * all (its history list carries the full payload), and its feedback endpoint
 * updates any row with no ownership check whatsoever. Both verbs here are
 * ownership-checked.
 *
 * BOTH handlers resolve the row through the user-scoped store accessors, which
 * filter on `user_id` in SQL and re-assert it on the returned row. An id in the
 * URL is never treated as authority to read or delete: we just closed an authz
 * hole of exactly that shape on the strategy-enable route, and a by-id handler
 * that trusts the path segment is the same bug wearing a different hat.
 */

export const runtime = "nodejs";

function parseId(idParam: string): string {
  const id = idParam.trim();
  if (!id || id.length > 64) throw new ApiError(400, "Invalid analysis id.");
  return id;
}

/** Read one analysis the caller owns. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const { id: idParam } = await ctx.params;
    const analysis = await getQuantAnalysis(userId, parseId(idParam));
    // Another tenant's id is a 404, not a 403 — an ownership check that
    // distinguishes the two leaks which ids exist.
    if (!analysis) throw new ApiError(404, "Analysis not found.");
    return NextResponse.json({ analysis });
  } catch (err) {
    return handleError(err);
  }
}

/** Delete an analysis the caller owns. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const { id: idParam } = await ctx.params;
    const ok = await deleteQuantAnalysis(userId, parseId(idParam));
    if (!ok) throw new ApiError(404, "Analysis not found.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
