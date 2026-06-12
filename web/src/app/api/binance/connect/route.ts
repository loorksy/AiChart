import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { getAccountSummary, getApiRestrictions } from "@/lib/binance";
import { saveBinanceAccount } from "@/lib/store";

const schema = z.object({
  apiKey: z.string().min(10, "مفتاح API غير صالح."),
  apiSecret: z.string().min(10, "السر غير صالح."),
  env: z.enum(["testnet", "prod"]).default("testnet"),
  label: z.string().max(60).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { apiKey, apiSecret, env, label } = schema.parse(await req.json());

    // Verify the credentials work before persisting them.
    const summary = await getAccountSummary(apiKey, apiSecret, env);
    if (!summary.canTrade) {
      return NextResponse.json(
        { error: "هذا المفتاح لا يملك صلاحية التداول. فعّل التداول في إعدادات Binance." },
        { status: 400 },
      );
    }

    await saveBinanceAccount(user.id, apiKey, apiSecret, env, label);

    // Detailed key permission report (prod only). Withdrawals on an API key
    // are a critical risk: a leaked key would drain the whole account.
    const restrictions = await getApiRestrictions(apiKey, apiSecret, env);
    const withdrawalsEnabled =
      summary.canWithdraw || Boolean(restrictions?.enableWithdrawals);

    return NextResponse.json({
      ok: true,
      env,
      canTrade: summary.canTrade,
      canWithdraw: summary.canWithdraw,
      restrictions,
      // Surfacing a strong security warning if withdrawals are enabled.
      withdrawWarning: withdrawalsEnabled
        ? "تحذير أمني حرج: مفتاحك يملك صلاحية السحب (Withdrawals). عطّلها فوراً من إعدادات Binance API — المنصة لا تستخدم السحب أبداً ووجود الصلاحية خطر تسريب."
        : null,
      ipRestrictionAdvice:
        restrictions && !restrictions.ipRestrict
          ? "نصيحة أمنية: قيّد المفتاح بعناوين IP محددة من إعدادات Binance API."
          : null,
      balances: summary.balances.slice(0, 20),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}
