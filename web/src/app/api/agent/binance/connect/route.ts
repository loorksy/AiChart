import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgentAuth, resolveAgentUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getAccountSummary, getApiRestrictions } from "@/lib/binance";
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

    // Withdrawals must stay disabled on API keys: a leaked key with
    // withdrawal rights means total loss. Warn loudly (but don't block).
    const restrictions = await getApiRestrictions(apiKey, apiSecret, env);
    const withdrawalsEnabled =
      summary.canWithdraw || Boolean(restrictions?.enableWithdrawals);
    const warning = withdrawalsEnabled
      ? "تحذير أمني: هذا المفتاح يسمح بالسحب (Withdrawals). عطّل صلاحية السحب من إعدادات Binance API فوراً — تسريب المفتاح يعني سرقة كامل الرصيد."
      : null;
    if (warning) {
      await logAudit(userId, "agent_binance_connect_warning", "canWithdraw=true");
    }

    return NextResponse.json({
      ok: true,
      env,
      canTrade: summary.canTrade,
      canWithdraw: summary.canWithdraw,
      restrictions,
      warning,
      balances: summary.balances.slice(0, 10),
    });
  } catch (e) {
    return handleError(e);
  }
}
