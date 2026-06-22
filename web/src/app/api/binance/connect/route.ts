import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getAccountSummary, getApiRestrictions } from "@/lib/binance";
import { buildBinancePermissionReport } from "@/lib/binanceVerify";
import { saveBinanceAccount } from "@/lib/store";

const schema = z.object({
  apiKey: z.string().min(10, "مفتاح API غير صالح."),
  apiSecret: z.string().min(10, "السر غير صالح."),
  env: z.enum(["testnet", "prod"]).default("testnet"),
  region: z.enum(["global", "us", "tr"]).default("global"),
  label: z.string().max(60).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const { apiKey, apiSecret, env, region, label } = schema.parse(await req.json());

    // Verify the credentials work before persisting them.
    const summary = await getAccountSummary(apiKey, apiSecret, env, region);
    if (!summary.canTrade) {
      return NextResponse.json(
        { error: "هذا المفتاح لا يملك صلاحية التداول. فعّل التداول في إعدادات Binance." },
        { status: 400 },
      );
    }

    await saveBinanceAccount(user.id, apiKey, apiSecret, env, label, region);

    const restrictions = await getApiRestrictions(apiKey, apiSecret, env, region);
    const permissionReport = buildBinancePermissionReport(
      summary,
      restrictions,
      env,
    );

    return NextResponse.json({
      ok: true,
      env,
      region,
      canTrade: summary.canTrade,
      canWithdraw: summary.canWithdraw,
      restrictions,
      permissionReport,
      withdrawWarning: permissionReport.withdrawWarning,
      ipRestrictionAdvice: permissionReport.ipRestrictionAdvice,
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
