import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { getAccountSummary, getApiRestrictions } from "@/lib/binance";
import { buildBinancePermissionReport } from "@/lib/binanceVerify";
import { logAudit, saveBinanceAccount, getBinanceCredentials, getBinanceAccountMeta } from "@/lib/store";

const schema = z.object({
  apiKey: z.string().min(10).optional(),
  apiSecret: z.string().min(10).optional(),
  env: z.enum(["testnet", "prod"]).optional(),
  region: z.enum(["global", "us", "tr"]).optional(),
  label: z.string().max(60).optional(),
  futuresRequired: z.boolean().optional(),
  /** When true, check permissions only — do not save keys. */
  verify_only: z.boolean().optional(),
});

/** Bridge: connect or verify Binance API key permissions. */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const futuresRequired =
      req.nextUrl.searchParams.get("futuresRequired") === "1" ||
      req.nextUrl.searchParams.get("futuresRequired") === "true";

    const meta = await getBinanceAccountMeta(userId);
    const creds = await getBinanceCredentials(userId);
    if (!meta || !creds) {
      return NextResponse.json(
        { ok: false, reason: "لا يوجد حساب Binance مرتبط." },
        { status: 400 },
      );
    }

    const summary = await getAccountSummary(
      creds.apiKey,
      creds.apiSecret,
      creds.env,
      creds.region,
    );
    const restrictions = await getApiRestrictions(
      creds.apiKey,
      creds.apiSecret,
      creds.env,
      creds.region,
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
      region: creds.region,
      canTrade: summary.canTrade,
      canWithdraw: summary.canWithdraw,
      restrictions,
      permissionReport,
      warning: permissionReport.withdrawWarning,
      balances: summary.balances.slice(0, 10),
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const env = body.env ?? "testnet";
    const region = body.region ?? "global";
    const futuresRequired = body.futuresRequired ?? false;

    if (body.verify_only) {
      if (!body.apiKey || !body.apiSecret) {
        return NextResponse.json(
          { ok: false, error: "apiKey و apiSecret مطلوبان للتحقق." },
          { status: 400 },
        );
      }
      const summary = await getAccountSummary(body.apiKey, body.apiSecret, env, region);
      const restrictions = await getApiRestrictions(
        body.apiKey,
        body.apiSecret,
        env,
        region,
      );
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
        warning: permissionReport.withdrawWarning,
      });
    }

    if (!body.apiKey || !body.apiSecret) {
      return NextResponse.json(
        { ok: false, error: "apiKey و apiSecret مطلوبان." },
        { status: 400 },
      );
    }

    const summary = await getAccountSummary(body.apiKey, body.apiSecret, env, region);
    if (!summary.canTrade) {
      return NextResponse.json(
        { ok: false, error: "المفتاح لا يملك صلاحية التداول." },
        { status: 400 },
      );
    }

    await saveBinanceAccount(userId, body.apiKey, body.apiSecret, env, body.label, region);
    await logAudit(userId, "agent_binance_connect", `${env}/${region}`);

    const restrictions = await getApiRestrictions(
      body.apiKey,
      body.apiSecret,
      env,
      region,
    );
    const permissionReport = buildBinancePermissionReport(
      summary,
      restrictions,
      env,
      { futuresRequired },
    );
    if (permissionReport.withdrawWarning) {
      await logAudit(userId, "agent_binance_connect_warning", "canWithdraw=true");
    }

    return NextResponse.json({
      ok: true,
      env,
      canTrade: summary.canTrade,
      canWithdraw: summary.canWithdraw,
      restrictions,
      permissionReport,
      warning: permissionReport.withdrawWarning,
      balances: summary.balances.slice(0, 10),
    });
  } catch (e) {
    return handleError(e);
  }
}
