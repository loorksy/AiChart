import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { respondToApproval } from "@/lib/approvalFlow";
import { logAudit } from "@/lib/store";

const schema = z.object({
  intent_id: z.number().int().positive(),
  action: z.enum(["approve", "reject"]),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const result = await respondToApproval(userId, body.intent_id, body.action);
    await logAudit(
      userId,
      "agent_approval_respond",
      `#${body.intent_id} ${body.action} → ${result.status}`,
    );
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
