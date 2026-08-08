import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { quantAgentServiceEnabled, setQuantStrategyEnabled } from "@/lib/quantAgent/client";

/**
 * Thin proxy onto `PATCH /internal/quant-agent/strategies/{id}` (plan §5),
 * restricted server-side to `source_generated=true` rows only — it can never
 * touch the platform's two fixed built-in strategies. This is the ONLY path
 * that makes a strategy Quant Agent Chat proposed actually live; every
 * proposal is otherwise always persisted disabled.
 */
const schema = z.object({ enabled: z.boolean().optional() }).partial();

function requestIdFrom(req: NextRequest): string {
  return req.headers.get("x-request-id")?.trim() || randomUUID();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ strategyId: string }> }) {
  try {
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const userId = await resolveQuantAgentUserId(req);
    const { strategyId } = await ctx.params;
    const body = schema.parse(await req.json().catch(() => ({})));
    const result = await setQuantStrategyEnabled(
      { userId, requestId: requestIdFrom(req) },
      strategyId,
      body.enabled ?? true,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return handleError(err);
  }
}
