import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { previewBotConfig } from "@/lib/quantAgent/botStore";
import { QUANT_BOT_DEFAULT_EXECUTION_MODE } from "@/lib/quantAgent/bots/brokerPort";
import {
  BotRecommendationError,
  recommendBotConfig,
} from "@/lib/quantAgent/bots/recommendConfig";
import { fetchQuantAgentBars } from "@/lib/quantAgent/marketFeed";

/**
 * Describe a bot in words; get a clamped configuration back.
 *
 * SIMULATION ONLY. The answer is a configuration to replay against history,
 * not a trade to place — see `lib/quantAgent/bots/brokerPort.ts`.
 *
 * The model's answer never goes anywhere unchecked: it is clamped in
 * `recommendConfig.ts` and then run through the SAME preview endpoint a
 * hand-typed config goes through, so the response carries both the
 * recommendation and the ladder it actually produces. A recommendation that
 * previews as invalid says so instead of being presented as ready to save.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/services/strategy_bot_recommend.py`. What changed
 * is documented at length in `lib/quantAgent/bots/recommendConfig.ts`; the
 * headline is that `strategyParams` speaks the vocabulary the engine reads
 * rather than upstream's dead legacy one, and `trend` is gone because nothing
 * implements it.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

/** Upstream's own candidate depth for the market block. */
const RECOMMEND_BAR_LIMIT = 200;

const recommendSchema = z
  .object({
    prompt: z.string().trim().min(3).max(2000),
    symbol: z.string().trim().min(1).max(32),
    interval: z.string().trim().min(1).max(16).optional(),
    locale: z.enum(["ar", "en"]).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const body = recommendSchema.parse(await req.json());
    const interval = body.interval ?? "1h";

    // A feed failure is not fatal: the recommender's no-data branch tells the
    // model to be conservative and to have the user verify the bounds. What it
    // must never do is invent a price to fill the gap.
    let bars: Awaited<ReturnType<typeof fetchQuantAgentBars>>["bars"] = [];
    let feedWarning: string | null = null;
    try {
      const feed = await fetchQuantAgentBars({
        userId,
        symbol: body.symbol,
        interval,
        limit: RECOMMEND_BAR_LIMIT,
      });
      bars = feed.bars;
      feedWarning = feed.warning ?? null;
    } catch (error) {
      feedWarning = error instanceof Error ? error.message : "market data unavailable";
    }

    const recommendation = await recommendBotConfig({
      prompt: body.prompt,
      symbol: body.symbol,
      interval,
      bars,
      locale: body.locale,
    });

    const preview = await previewBotConfig(
      userId,
      recommendation.botType,
      recommendation.strategyParams,
    );

    return NextResponse.json({
      executionMode: QUANT_BOT_DEFAULT_EXECUTION_MODE,
      recommendation,
      preview,
      barCount: bars.length,
      warning: feedWarning,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }
    if (err instanceof BotRecommendationError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return handleError(err);
  }
}
