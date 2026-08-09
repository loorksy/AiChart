import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError } from "@/lib/api";
import {
  generateQuantRecommendation,
  listQuantRecommendations,
  quantAgentServiceEnabled,
} from "@/lib/quantAgent/client";
import { fetchQuantAgentBars, QuantAgentMarketFeedError } from "@/lib/quantAgent/marketFeed";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";

/**
 * Thin proxy onto the isolated Quant Agent Service (engineering plan §4).
 * No DB writes here, no call to createCanonicalRecommendation /
 * applyRecommendationRevision — this is a second, independent decision
 * engine whose output never lands in the canonical `recommendations` table.
 */

const generateSchema = z
  .object({
    symbol: z.string().min(1).max(32),
    market: z.string().min(1).max(16).optional(),
    interval: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]).optional(),
    limit: z.number().finite().min(50).max(5000).optional(),
  })
  .strict();

function requestIdFrom(req: NextRequest): string {
  return req.headers.get("x-request-id")?.trim() || randomUUID();
}

/** GET — proxies the service's recommendation list for a symbol/state. */
export async function GET(req: NextRequest) {
  try {
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ ok: true, enabled: false, recommendations: [] });
    }
    const userId = await resolveQuantAgentUserId(req);
    const { searchParams } = req.nextUrl;
    const symbol = searchParams.get("symbol")?.trim() || undefined;
    const state = searchParams.get("state")?.trim() || undefined;

    const recommendations = await listQuantRecommendations(
      { userId, requestId: requestIdFrom(req) },
      { symbol, state },
    );
    return NextResponse.json({ ok: true, enabled: true, recommendations });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST — assembles OHLC bars for the requested symbol/interval via the SAME
 * pipe `/api/agent/market/ohlc` uses, pushes them to the service, and relays
 * whatever it decides (a recommendation, or an explicit "no signal").
 */
export async function POST(req: NextRequest) {
  try {
    if (!quantAgentServiceEnabled()) {
      throw new ApiError(503, "خدمة Quant Agent غير مفعّلة.");
    }
    const userId = await resolveQuantAgentUserId(req);
    const body = generateSchema.parse(await req.json());
    const context = { userId, requestId: requestIdFrom(req) };

    let feed;
    try {
      feed = await fetchQuantAgentBars({
        userId,
        symbol: body.symbol,
        interval: body.interval,
        market: body.market,
        limit: body.limit,
      });
    } catch (error) {
      if (error instanceof QuantAgentMarketFeedError) {
        throw new ApiError(400, error.message);
      }
      throw error;
    }

    if (!feed.bars.length) {
      return NextResponse.json({
        ok: true,
        recommendation: null,
        no_signal: true,
        reason: feed.warning || "لا توجد شموع متاحة لهذا الرمز حاليًا.",
      });
    }

    const recommendation = await generateQuantRecommendation(context, {
      symbol: feed.symbol,
      market: feed.market,
      interval: feed.interval,
      bars: feed.bars,
    });

    return NextResponse.json(
      { ok: true, recommendation, no_signal: recommendation == null },
      { status: recommendation ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "طلب غير صالح." },
        { status: 400 },
      );
    }
    return handleError(error);
  }
}
