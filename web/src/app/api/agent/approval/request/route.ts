import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { createApprovalRequest } from "@/lib/approvalFlow";
import { normalizeIntentSymbol } from "@/lib/markets/resolve";
import type { MarketType } from "@/lib/markets/types";
import { logAudit } from "@/lib/store";

const schema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  notional: z.number().positive().optional(),
  market: z.enum(["crypto", "forex"]).optional(),
  entry: z.number().nullish(),
  stop_loss: z.number().nullish(),
  take_profit: z.number().nullish(),
  confidence: z.number().min(0).max(100).default(0),
  rationale: z.string().nullish(),
  recommendation_id: z.number().nullish(),
  practice: z.boolean().default(false),
  kind: z
    .enum(["trade", "practice", "env_switch", "kill_switch", "mode_change"])
    .optional(),
  photo_url: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    const market = (body.market ?? "crypto") as MarketType;

    const result = await createApprovalRequest(userId, {
      symbol: normalizeIntentSymbol(body.symbol, market),
      side: body.side,
      notional: body.notional,
      market: body.market,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: body.take_profit ?? null,
      confidence: body.confidence,
      rationale: body.rationale ?? null,
      recommendation_id: body.recommendation_id ?? null,
      practice: body.practice,
      kind: body.kind,
      photoUrl: body.photo_url ?? null,
    });

    await logAudit(
      userId,
      "agent_approval_request",
      `#${result.intentId} ${body.symbol} ${body.side}`,
    );

    return NextResponse.json({
      ok: true,
      intentId: result.intentId,
      telegramDelivered: result.telegramDelivered,
      telegramReasonAr: result.reasonAr,
      message:
        "أُرسلت بطاقة الموافقة مع أزرار ✅/❌ — انتظر ضغط الزر قبل التنفيذ.",
    });
  } catch (e) {
    return handleError(e);
  }
}
