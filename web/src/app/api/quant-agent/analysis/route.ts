import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError } from "@/lib/api";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { listQuantAnalyses, QUANT_ANALYSIS_LIST_MAX_LIMIT } from "@/lib/quantAgent/analysisStore";
import { runQuantAnalysis } from "@/lib/quantAgent/analysis/runAnalysis";

/**
 * Quant Agent LLM trading analysis — run one, or list the caller's history.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/routes/fast_analysis.py` (`POST /analyze`,
 * `GET /history`). What changed: no credit metering and no async-submit
 * branch (there is no job queue behind this yet, so promising a task id we
 * cannot poll would be a lie); the history list is keyset-paginated and
 * STRICTLY user-scoped, where upstream's `/history` was not scoped by user at
 * all; and the in-flight lock keeps upstream's exact key shape and 90s TTL but
 * only in-process, since there is no Redis on this path.
 *
 * Follows `api/quant-agent/monitors/route.ts`'s convention throughout:
 * `resolveQuantAgentUserId` → zod `.parse()` → work → `NextResponse.json`,
 * with zod errors handled explicitly before the generic `handleError` catch.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

const runSchema = z
  .object({
    symbol: z.string().trim().min(1).max(32),
    market: z.string().trim().max(16).optional(),
    interval: z.string().trim().min(1).max(16).optional(),
    locale: z.enum(["ar", "en"]).optional(),
  })
  .strict();

/**
 * Upstream's in-flight guard (`fast_analysis_tasks.py:20-64`), thread-dict
 * flavour: one analysis per (user, market, symbol, timeframe) at a time, 90s
 * TTL. A full analysis is several candle reads plus an LLM call, so a
 * double-tapped Analyze button is real money and a real second row.
 *
 * In-process only. That is honest about what it protects: one server
 * instance's own duplicate submissions, not a cluster-wide claim. Upstream's
 * Redis path has no counterpart here because nothing else on this route needs
 * Redis, and a lock that silently degrades across instances is worse than one
 * whose scope is written down.
 */
const INFLIGHT_TTL_MS = 90_000;
const inflight = new Map<string, number>();

function acquireInflight(key: string): boolean {
  const now = Date.now();
  const heldUntil = inflight.get(key);
  if (heldUntil != null && heldUntil > now) return false;
  // Opportunistic sweep so an abandoned key cannot pin memory forever.
  if (inflight.size > 512) {
    for (const [k, expiry] of inflight) {
      if (expiry <= now) inflight.delete(k);
    }
  }
  inflight.set(key, now + INFLIGHT_TTL_MS);
  return true;
}

function releaseInflight(key: string): void {
  inflight.delete(key);
}

/** Run one analysis and return the stored row. */
export async function POST(req: NextRequest) {
  let inflightKey: string | null = null;
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const body = runSchema.parse(await req.json().catch(() => ({})));
    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) throw new ApiError(400, marketErr);
    const market = resolveActiveMarket(body.market);

    inflightKey = `${userId}|${market.toUpperCase()}|${body.symbol.toUpperCase()}|${(
      body.interval ?? "1h"
    ).toUpperCase()}`;
    if (!acquireInflight(inflightKey)) {
      inflightKey = null; // not ours to release
      return NextResponse.json(
        { error: "يوجد تحليل قيد التنفيذ لهذا الرمز والإطار الزمني. يرجى الانتظار." },
        { status: 429 },
      );
    }

    const analysis = await runQuantAnalysis({
      userId,
      symbol: body.symbol,
      market,
      interval: body.interval,
      locale: body.locale,
    });
    return NextResponse.json({ analysis }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return handleError(err);
  } finally {
    if (inflightKey) releaseInflight(inflightKey);
  }
}

/** List the caller's own analyses, newest first (`?limit=&cursor=&symbol=`). */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam == null ? undefined : Number(limitParam);
    if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
      throw new ApiError(400, "Invalid limit.");
    }
    const page = await listQuantAnalyses(userId, {
      limit: parsedLimit === undefined ? undefined : Math.min(parsedLimit, QUANT_ANALYSIS_LIST_MAX_LIMIT),
      cursor: url.searchParams.get("cursor"),
      symbol: url.searchParams.get("symbol"),
    });
    return NextResponse.json({ analyses: page.items, nextCursor: page.nextCursor });
  } catch (err) {
    return handleError(err);
  }
}
