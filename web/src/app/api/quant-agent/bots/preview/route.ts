import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { previewBotConfig } from "@/lib/quantAgent/botStore";
import { QUANT_BOT_EXECUTION_MODE } from "@/lib/quantAgent/bots/brokerPort";
import { QUANT_BOT_TYPES } from "@/lib/quantAgent/bots/types";

/**
 * The level ladder a bot configuration would produce, plus every warning it
 * earns.
 *
 * Pure: nothing is stored, nothing is simulated, nothing is executed. This is
 * what the config form calls as the user types, which is why an invalid config
 * comes back as a 200 with `status: "invalid"` rather than an HTTP error — the
 * explanation belongs in the body, next to the ladder it replaces.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/routes/strategy.py`'s executor preview route.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const previewSchema = z
  .object({
    botType: z.enum(QUANT_BOT_TYPES as unknown as [string, ...string[]]),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const body = previewSchema.parse(await req.json());
    const preview = await previewBotConfig(
      userId,
      body.botType as (typeof QUANT_BOT_TYPES)[number],
      body.config,
    );
    return NextResponse.json({ executionMode: QUANT_BOT_EXECUTION_MODE, preview });
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
