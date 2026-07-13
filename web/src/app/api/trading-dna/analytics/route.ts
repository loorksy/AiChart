import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/api";
import { computeTradingDnaAnalytics } from "@/lib/tradingDna";

/** Authenticated analytics over immutable Trading DNA snapshots. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await computeTradingDnaAnalytics(user.id));
  } catch (error) {
    return handleError(error);
  }
}
