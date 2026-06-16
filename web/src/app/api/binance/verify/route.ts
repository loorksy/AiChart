import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getAccountSummary, getApiRestrictions } from "@/lib/binance";
import { buildBinancePermissionReport } from "@/lib/binanceVerify";
import { getBinanceCredentials, getBinanceAccountMeta } from "@/lib/store";

const bodySchema = z.object({
  apiKey: z.string().min(10).optional(),
  apiSecret: z.string().min(10).optional(),
  env: z.enum(["testnet", "prod"]).optional(),
  futuresRequired: z.boolean().optional(),
});

/**
 * Live permission check without saving keys.
 * GET — uses stored credentials; POST — optional inline keys for pre-connect verify.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const futuresRequired =
      req.nextUrl.searchParams.get("futuresRequired") === "1" ||
      req.nextUrl.searchParams.get("futuresRequired") === "true";

    const meta = await getBinanceAccountMeta(user.id);
    const creds = await getBinanceCredentials(user.id);
    if (!meta || !creds) {
      return NextResponse.json(
        { ok: false, error: "لا يوجد حساب Binance مرتبط." },
        { status: 400 },
      );
    }

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
      ok: permissionReport.ok,
      env: creds.env,
      canTrade: summary.canTrade,
      canWithdraw: summary.canWithdraw,
      restrictions,
      permissionReport,
      withdrawWarning: permissionReport.withdrawWarning,
      ipRestrictionAdvice: permissionReport.ipRestrictionAdvice,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePlatformAccess();
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const { apiKey, apiSecret, env = "testnet", futuresRequired = false } =
      body;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { ok: false, error: "أدخل apiKey و apiSecret." },
        { status: 400 },
      );
    }

    const summary = await getAccountSummary(apiKey, apiSecret, env);
    const restrictions = await getApiRestrictions(apiKey, apiSecret, env);
    const permissionReport = buildBinancePermissionReport(
      summary,
      restrictions,
      env,
      { futuresRequired },
    );

    return NextResponse.json({
      ok: permissionReport.ok,
      env,
      canTrade: summary.canTrade,
      canWithdraw: summary.canWithdraw,
      restrictions,
      permissionReport,
      withdrawWarning: permissionReport.withdrawWarning,
      ipRestrictionAdvice: permissionReport.ipRestrictionAdvice,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}
