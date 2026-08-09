import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError } from "@/lib/api";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { getBot, simulateBot } from "@/lib/quantAgent/botStore";
import { QUANT_BOT_DEFAULT_EXECUTION_MODE } from "@/lib/quantAgent/bots/brokerPort";
import { QUANT_BOT_SIMULATABLE_TYPES } from "@/lib/quantAgent/bots/types";
import { fetchQuantAgentBars } from "@/lib/quantAgent/marketFeed";

/**
 * Replay one saved bot against historical candles.
 *
 * SIMULATION ONLY, and this is the endpoint where that matters most. It reads
 * candles, hands them to quant-agent's grid engine, and returns what WOULD
 * have happened. No order is placed at any point in this request, and no code
 * path from here can reach a broker: quant-agent's engine talks only to
 * `SimulatedQuantBroker`, and `lib/quantAgent/bots/brokerPort.ts` — the seam
 * that would have to change on this side — throws unconditionally.
 *
 * Ownership is resolved BEFORE any candle is fetched, through the same
 * user-scoped store accessor every other by-id bot handler uses. A request for
 * someone else's bot never reaches the market feed, let alone the engine.
 *
 * This endpoint has no upstream counterpart: QuantDinger runs its grid against
 * a real venue, so it has a `/start`, not a `/simulate`.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

/** Enough history for a grid to cycle several times without a huge payload. */
const DEFAULT_BAR_LIMIT = 1000;
const MAX_BAR_LIMIT = 5000;

const simulateSchema = z
  .object({
    limit: z.number().int().min(2).max(MAX_BAR_LIMIT).optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const { id: idParam } = await ctx.params;
    const id = idParam.trim();
    if (!id || id.length > 64) throw new ApiError(400, "Invalid bot id.");

    const raw: unknown = await req.json().catch(() => ({}));
    const body = simulateSchema.parse(raw ?? {});

    const bot = await getBot(userId, id);
    if (!bot) throw new ApiError(404, "Bot not found.");
    if (!QUANT_BOT_SIMULATABLE_TYPES.includes(bot.botType)) {
      // Honest refusal rather than an empty run: DCA and both martingales are
      // level ladders with no replay engine behind them.
      throw new ApiError(
        422,
        `${bot.botType} bots preview a level ladder but have no replay engine yet.`,
      );
    }

    const feed = await fetchQuantAgentBars({
      userId,
      symbol: bot.symbol,
      interval: bot.interval,
      market: bot.market,
      limit: body.limit ?? DEFAULT_BAR_LIMIT,
    });
    if (feed.bars.length < 2) {
      throw new ApiError(
        422,
        feed.warning ?? "No candles are available for this symbol and interval.",
      );
    }

    const simulation = await simulateBot(userId, id, feed.bars);
    if (!simulation) throw new ApiError(404, "Bot not found.");

    return NextResponse.json({
      executionMode: QUANT_BOT_DEFAULT_EXECUTION_MODE,
      simulation,
      barCount: feed.bars.length,
      warning: feed.warning ?? null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
