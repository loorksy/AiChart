import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { generateQuantStrategyCodeFromDescription } from "@/lib/agent/quantAgentChat/orchestrator";

/**
 * Direct, non-conversational strategy generation (plan §3/§4) — no chat
 * session required. Runs the same draft → validate → one repair attempt →
 * done flow as the `generate_strategy` chat intent, factored into
 * `generateQuantStrategyCodeFromDescription` (the sandboxed-code path, now
 * the default mechanism for technical parity with QuantDinger). Exists for
 * the sibling MCP tool `quant_agent_generate_strategy` to call directly.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  description: z.string().min(1).max(2000),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const body = schema.parse(await req.json());
    const outcome = await generateQuantStrategyCodeFromDescription(userId, body.description);
    return NextResponse.json(outcome, { status: outcome.status === "persisted" ? 201 : 422 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return handleError(err);
  }
}
