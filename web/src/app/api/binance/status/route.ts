import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getBinanceCredentials, getBinanceAccountMeta } from "@/lib/store";
import { getAccountSummary, getApiRestrictions } from "@/lib/binance";
import { buildBinancePermissionReport } from "@/lib/binanceVerify";

export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const futuresRequired =
      req.nextUrl.searchParams.get("futuresRequired") === "1" ||
      req.nextUrl.searchParams.get("futuresRequired") === "true";

    const meta = await getBinanceAccountMeta(user.id);
    if (!meta) {
      return NextResponse.json({ connected: false });
    }
    const creds = await getBinanceCredentials(user.id);
    if (!creds) return NextResponse.json({ connected: false });

    try {
      const summary = await getAccountSummary(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
      );
      const restrictions = await getApiRestrictions(
        creds.apiKey,
        creds.apiSecret,
        creds.env,
      );
      const permissionReport = buildBinancePermissionReport(
        summary,
        restrictions,
        creds.env,
        { futuresRequired },
      );

      return NextResponse.json({
        connected: true,
        env: meta.env,
        label: meta.label,
        canTrade: summary.canTrade,
        canWithdraw: summary.canWithdraw,
        restrictions,
        permissionReport,
        withdrawWarning: permissionReport.withdrawWarning,
        ipRestrictionAdvice: permissionReport.ipRestrictionAdvice,
        balances: summary.balances.slice(0, 30),
      });
    } catch (e) {
      return NextResponse.json({
        connected: true,
        env: meta.env,
        label: meta.label,
        reachable: false,
        error: e instanceof Error ? e.message : "تعذّر الاتصال بـ Binance.",
      });
    }
  } catch (err) {
    return handleError(err);
  }
}
