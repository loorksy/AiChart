import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { respondToApproval } from "@/lib/approvalFlow";
import { getIntent, logAudit } from "@/lib/store";

const schema = z.object({
  intent_id: z.number().int().positive(),
  action: z.enum(["approve", "reject"]),
  /** Preview only: shows what this response would do, resolves nothing. */
  dry_run: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    if (body.dry_run) {
      const intent = await getIntent(body.intent_id, userId);
      if (!intent || intent.user_id !== userId) {
        return NextResponse.json({ ok: false, dry_run: true, reason: "الطلب غير موجود." });
      }
      if (intent.status !== "pending") {
        return NextResponse.json({
          ok: false,
          dry_run: true,
          status: intent.status,
          reason: "تمّت معالجة هذا الطلب مسبقاً.",
        });
      }
      return NextResponse.json({
        ok: true,
        dry_run: true,
        would: body.action,
        pending_intent: {
          symbol: intent.symbol,
          side: intent.side,
          entry: intent.entry,
          stop_loss: intent.stop_loss,
          take_profit: intent.take_profit,
          notional: intent.notional,
          broker: intent.broker,
          rationale: intent.rationale,
          authorization_source: intent.authorization_source,
        },
        note:
          body.action === "approve"
            ? "Approving executes this trade immediately on the connected broker."
            : "Rejecting only marks the request rejected — no broker call.",
      });
    }

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
