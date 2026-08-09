import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getSettings, logAudit, updateSettings } from "@/lib/store";
import { RISK_PER_TRADE, riskPerTradeSchema } from "@/lib/productModel";

const patchSchema = z.object({ per_trade_pct: riskPerTradeSchema }).strict();

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(request);
    const settings = await getSettings(userId);
    return NextResponse.json({
      per_trade_pct: settings.per_trade_pct,
      risk_per_trade: RISK_PER_TRADE,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(request);
    const input = patchSchema.parse(await request.json());
    await updateSettings(userId, { per_trade_pct: input.per_trade_pct });
    await logAudit(userId, "risk_per_trade_update", `per_trade_pct=${input.per_trade_pct}`);
    return NextResponse.json({ ok: true, ...input });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(error);
  }
}
