import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { getQuantAnalysisAccuracy } from "@/lib/quantAgent/analysisStore";

/**
 * The caller's own historical hit rate per confidence bucket — what the
 * accuracy strip on `/quant-agent/analysis` reads.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/routes/fast_analysis.py` (`GET /performance`,
 * which returns a single blended `accuracy_pct`). What changed: the number is
 * broken out per confidence bucket, because one blended figure cannot tell a
 * reader whether the engine's HIGH-confidence calls are the reliable ones —
 * which is the only question worth asking of it. Buckets below the five-sample
 * floor are omitted entirely rather than reported as a hit rate, so the UI can
 * say "not enough history" instead of showing a number built from two rows.
 *
 * User-scoped in SQL, like every other read in `analysisStore`. Upstream's
 * `/performance` aggregates across all users.
 *
 * Path note: `accuracy` is a STATIC segment sitting beside `[id]`, and Next
 * resolves static before dynamic. Analysis ids are `randomUUID()` values, so
 * none can ever be the literal string "accuracy" and be shadowed by this.
 */

export const runtime = "nodejs";

/**
 * `get_confidence_accuracy_by_bucket(days=90)` upstream. A quarter is long
 * enough to fill the buckets and recent enough that the engine being measured
 * is roughly the engine running now.
 */
const ACCURACY_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

/**
 * `?symbol=` narrows to one pair. The analysis page does NOT pass it —
 * calibration is a property of the engine, not of one pair, and a per-symbol
 * split puts every bucket back under the five-sample floor on all but the
 * busiest account. It stays available because upstream's aggregate takes the
 * same optional filter and a per-symbol read is a legitimate question to ask
 * of an account with enough history to answer it.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const symbol = new URL(req.url).searchParams.get("symbol");
    const accuracy = await getQuantAnalysisAccuracy(userId, {
      symbol: symbol && symbol.trim().length ? symbol.trim().toUpperCase() : null,
      sinceMs: Date.now() - ACCURACY_WINDOW_DAYS * DAY_MS,
    });
    return NextResponse.json({ accuracy, windowDays: ACCURACY_WINDOW_DAYS });
  } catch (err) {
    return handleError(err);
  }
}
