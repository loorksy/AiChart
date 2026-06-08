import { NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { getBinanceCredentials, getBinanceAccountMeta } from "@/lib/store";
import { getAccountSummary } from "@/lib/binance";

export async function GET() {
  try {
    const user = await requireUser();
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
      return NextResponse.json({
        connected: true,
        env: meta.env,
        label: meta.label,
        canTrade: summary.canTrade,
        canWithdraw: summary.canWithdraw,
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
