import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { getPublicUser } from "@/lib/store";
import { quantAgentServiceEnabled, setQuantStrategyEnabled } from "@/lib/quantAgent/client";

/**
 * Thin proxy onto `PATCH /internal/quant-agent/strategies/{id}` (plan §5),
 * restricted server-side to `source_generated=true` rows only — it can never
 * touch the platform's two fixed built-in strategies. This is the ONLY path
 * that makes a strategy Quant Agent Chat proposed actually live; every
 * proposal is otherwise always persisted disabled.
 *
 * Two deliberate restrictions, because of what "live" costs here: enabling a
 * row admits LLM-written Python into `registered_strategies_with_generated`,
 * which the every-15-minutes `quant-agent-scan` cron then executes to produce
 * Telegram recommendations on the SHARED, symbol-scoped feed — not just for
 * whoever generated it.
 *
 *  1. `enabled` is REQUIRED, not optional-defaulting-to-true. It previously
 *     read `body.enabled ?? true`, so an empty or malformed body — the exact
 *     thing a stray curl or a client bug produces — took the enable branch.
 *     A missing field is now a 400.
 *  2. Admin only. Strategy rows are global and carry no owner column, so a
 *     plain ownership check has nothing to compare against; until strategies
 *     are genuinely user-scoped, restricting the toggle to administrators is
 *     the honest minimum. Without it any signed-in account could enable any
 *     other account's generated strategy for the whole platform.
 */
const schema = z.object({ enabled: z.boolean() });

function requestIdFrom(req: NextRequest): string {
  return req.headers.get("x-request-id")?.trim() || randomUUID();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ strategyId: string }> }) {
  try {
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const userId = await resolveQuantAgentUserId(req);
    // Checked on the RESOLVED id, so the bridge path (service token +
    // X-Aichart-User-Email) is held to the same bar as a browser session —
    // holding the service token must not be a way around this.
    const actor = await getPublicUser(userId);
    if (actor?.role !== "admin") {
      throw new ApiError(403, "تفعيل استراتيجية مولَّدة يتطلب صلاحيات الإدارة.");
    }
    const { strategyId } = await ctx.params;
    const body = schema.parse(await req.json().catch(() => ({})));
    const result = await setQuantStrategyEnabled(
      { userId, requestId: requestIdFrom(req) },
      strategyId,
      body.enabled,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return handleError(err);
  }
}
