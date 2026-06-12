import { NextResponse } from "next/server";
import { requireUser, handleError } from "@/lib/api";
import { fetchMarketContext } from "@/lib/marketContext";
import { profileForInterval } from "@/lib/analysisProfile";

/** Macro headlines + fear/greed for command center ticker. */
export async function GET() {
  try {
    await requireUser();
    const ctx = await fetchMarketContext("BTCUSDT", profileForInterval("1h"));
    return NextResponse.json({ ok: true, context: ctx });
  } catch (e) {
    return handleError(e);
  }
}
