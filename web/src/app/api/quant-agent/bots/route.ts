import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { createBot, listBots } from "@/lib/quantAgent/botStore";
import { QUANT_BOT_EXECUTION_MODE } from "@/lib/quantAgent/bots/brokerPort";
import { QUANT_BOT_TYPES } from "@/lib/quantAgent/bots/types";

/**
 * Quant Agent automated bots — list the caller's, or save a new one.
 *
 * SIMULATION ONLY. There is no start, stop or deploy verb on this resource,
 * here or in quant-agent, because there is nothing behind one: the engine's
 * only broker is `SimulatedQuantBroker`. `lib/quantAgent/bots/brokerPort.ts`
 * is the seam that would have to change, and it throws unconditionally.
 * `executionMode` rides on every response so a client cannot lose that fact.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/routes/strategy.py`'s executor deploy routes.
 * What changed: the deploy half is gone entirely (credential binding,
 * `execution_mode: "live"`, exchange selection), and every read is
 * user-scoped, where upstream's list route scoped by strategy id alone.
 *
 * Follows `api/quant-agent/analysis/route.ts` throughout:
 * `resolveQuantAgentUserId` → zod `.parse()` → work → `NextResponse.json`.
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

/** Every bot the caller owns. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const bots = await listBots(userId);
    return NextResponse.json({ executionMode: QUANT_BOT_EXECUTION_MODE, bots });
  } catch (err) {
    return handleError(err);
  }
}

/** Save a bot configuration. Saving is not starting. */
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
      // Forex-only platform; the field exists so the service row is explicit.
      market: "forex",
      interval: body.interval,
      initialCapital: body.initialCapital ?? 1000,
      feeRate: body.feeRate ?? 0.001,
      config: body.config,
    });
    return NextResponse.json({ executionMode: QUANT_BOT_EXECUTION_MODE, bot });
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
