import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { quantAgentServiceEnabled, setQuantStrategyStatus } from "@/lib/quantAgent/client";
import { QUANT_STRATEGY_STATUSES } from "@/lib/quantAgent/types";

/**
 * Moves one of the caller's OWN generated strategies through its lifecycle.
 *
 * This replaced an admin-only enable toggle, and the reason is worth stating
 * because it looks like a relaxation and is not.
 *
 * The old restriction was correct for the code as it stood: strategy rows were
 * global, and `registered_strategies_with_generated` loaded every enabled
 * generated row for every caller. Enabling one therefore admitted LLM-written
 * Python into OTHER people's recommendations, and the 15-minute scan cron then
 * turned those into Telegram messages. With no owner column there was nothing
 * to check ownership against, so admin-only was the honest minimum.
 *
 * Strategies now carry an owner and the registry is scoped to it, so an owner
 * activating their own strategy affects exactly their own signals. The
 * permission question dissolved once the isolation was real; it was never
 * really a permission question.
 *
 * Two properties this route must keep:
 *
 *  1. `status` is REQUIRED. The predecessor read `body.enabled ?? true`, so an
 *     empty or malformed body — a stray curl, a client bug — took the enable
 *     branch. A missing or unknown status is a 400.
 *  2. Ownership is settled by the SERVICE against the stored row, not by
 *     anything the caller asserts. It answers 404 for every refusal — not
 *     yours, not generated, no such id — so a prober cannot tell which
 *     strategy ids exist. The resolved id is used, so the bridge path
 *     (service token + user header) is held to the same bar as a browser
 *     session; holding the service token is not a way around ownership.
 *
 * Activating is still signals-only. It never places an order.
 */
const schema = z.object({ status: z.enum(QUANT_STRATEGY_STATUSES) });

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
    const result = await setQuantStrategyStatus(
      { userId, requestId: requestIdFrom(req) },
      strategyId,
      body.status,
    );
    return NextResponse.json(result);
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
