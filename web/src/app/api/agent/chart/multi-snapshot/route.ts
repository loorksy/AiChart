import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  captureMultiTimeframeSnapshot,
  DEFAULT_IMAGE_TIMEOUT_MS,
  MAX_IMAGES_LIMIT,
} from "@/lib/chart/multiTimeframeCapture";
import {
  DEFAULT_MARKET,
  rejectNonForexMarket,
  resolveActiveMarket,
} from "@/lib/marketPolicy";

const schema = z.object({
  symbol: z.string().min(1),
  timeframes: z.array(z.string().min(1).max(16)).max(12).optional(),
  market: z.string().optional(),
  max_images: z.number().int().min(1).max(MAX_IMAGES_LIMIT).optional(),
  image_timeout_ms: z.number().int().min(2000).max(20000).optional(),
  /** Numeric context per timeframe (default on — the images are not evidence alone). */
  include_numeric_context: z.boolean().optional(),
  /** Bypass the short-TTL snapshot cache. */
  fresh: z.boolean().optional(),
});

/**
 * Bridge: several timeframes of one symbol captured in parallel, each image
 * paired with the deterministic numeric context for that same timeframe.
 *
 * Partial success is the contract: a timeframe that fails to render is listed
 * in `missing_timeframes` while every other timeframe still returns.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    const marketErr = rejectNonForexMarket(body.market);
    if (marketErr) {
      return NextResponse.json({ error: marketErr }, { status: 400 });
    }
    const market = resolveActiveMarket(body.market ?? DEFAULT_MARKET);

    const result = await captureMultiTimeframeSnapshot(userId, {
      symbol: body.symbol,
      timeframes: body.timeframes,
      market,
      maxImages: body.max_images,
      imageTimeoutMs: body.image_timeout_ms ?? DEFAULT_IMAGE_TIMEOUT_MS,
      includeNumericContext: body.include_numeric_context,
      skipCache: body.fresh === true,
    });

    // Nothing captured at all is a genuine failure, not a partial one.
    if (result.snapshots.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "تعذّر توليد صور الشارت لأي إطار زمني مطلوب.",
          ...result,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleError(e);
  }
}
