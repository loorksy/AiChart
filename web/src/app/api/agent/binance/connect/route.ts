import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getAccountSummary } from "@/lib/binance";
import { logAudit, saveBinanceAccount } from "@/lib/store";

const schema = z.object({
  apiKey: z.string().min(10),
  apiSecret: z.string().min(10),
  env: z.enum(["testnet", "prod"]).default("testnet"),
  label: z.string().max(60).optional(),
});

export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);
    const userId = await resolveAgentUserId();
    const { apiKey, apiSecret, env, label } = schema.parse(await req.json());

    const summary = await getAccountSummary(apiKey, apiSecret, env);
    if (!summary.canTrade) {
      return NextResponse.json(
        { ok: false, error: "المفتاح لا يملك صلاحية التداول." },
        { status: 400 },
      );
    }

    await saveBinanceAccount(userId, apiKey, apiSecret, env, label);
    await logAudit(userId, "agent_binance_connect", env);

    return NextResponse.json({
      ok: true,
      env,
      canTrade: summary.canTrade,
      balances: summary.balances.slice(0, 10),
    });
  } catch (e) {
    return handleError(e);
  }
}
