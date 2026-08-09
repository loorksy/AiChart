import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { createBot, listBots } from "@/lib/quantAgent/botStore";
import { QUANT_BOT_DEFAULT_EXECUTION_MODE } from "@/lib/quantAgent/bots/brokerPort";
import { QUANT_BOT_TYPES } from "@/lib/quantAgent/bots/types";
import { getMtAccountMeta } from "@/lib/store";
import { mtModeToExecution, normalizeMtTradeMode } from "@/lib/executionEnv";

/**
 * Quant Agent automated bots — list the caller's, or save a new one.
 *
 * Saving is not arming: new bots start in `simulation`. Live orders go through
 * `bots/liveExecution.ts` → createIntent → executeIntent.
 *
 * Every response includes the linked account type (demo/live) from the
 * broker-reported trade mode so the UI never leaves that ambiguous.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const createSchema = z
  .object({
    botType: z.enum(QUANT_BOT_TYPES as unknown as [string, ...string[]]),
    name: z.string().trim().min(1).max(80),
    symbol: z.string().trim().min(1).max(32),
    interval: z.string().trim().min(1).max(16),
    initialCapital: z.number().finite().min(0).max(1_000_000).optional(),
    feeRate: z.number().finite().min(0).max(0.05).optional(),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

async function accountTypeFor(userId: number) {
  const meta = await getMtAccountMeta(userId).catch(() => null);
  return mtModeToExecution(normalizeMtTradeMode(meta?.account_trade_mode));
}

/** Every bot the caller owns. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const [bots, accountType] = await Promise.all([listBots(userId), accountTypeFor(userId)]);
    return NextResponse.json({ bots, accountType });
  } catch (err) {
    return handleError(err);
  }
}

/** Save a bot configuration. Saving is not arming. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const body = createSchema.parse(await req.json());
    const bot = await createBot(userId, {
      botType: body.botType as (typeof QUANT_BOT_TYPES)[number],
      name: body.name,
      symbol: body.symbol,
      market: "forex",
      interval: body.interval,
      initialCapital: body.initialCapital ?? 1000,
      feeRate: body.feeRate ?? 0.001,
      config: body.config,
    });
    const accountType = await accountTypeFor(userId);
    return NextResponse.json({
      executionMode: bot.executionMode ?? QUANT_BOT_DEFAULT_EXECUTION_MODE,
      bot,
      accountType,
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
