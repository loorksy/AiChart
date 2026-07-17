import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError, requirePaidAccess } from "@/lib/api";
import {
  getLatestTradingDnaSnapshot,
  getPersonaForSnapshot,
  getTradingDnaSnapshot,
} from "@/lib/tradingDna";

/** Authenticated, tenant-scoped, read-only Trading DNA view. */
export async function GET(request: NextRequest) {
  try {
    const user = await requirePaidAccess();
    const requested = request.nextUrl.searchParams.get("snapshotId");
    const snapshot = requested
      ? await getTradingDnaSnapshot(user.id, requested)
      : await getLatestTradingDnaSnapshot(user.id);
    if (!snapshot) throw new ApiError(404, "Trading DNA snapshot not found.");
    const persona = await getPersonaForSnapshot(user.id, snapshot.snapshotId);
    return NextResponse.json({ snapshot, persona });
  } catch (error) {
    return handleError(error);
  }
}
