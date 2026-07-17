import { NextRequest, NextResponse } from "next/server";
import { handleError, requirePaidAccess } from "@/lib/api";
import { replayShadowRecommendation } from "@/lib/tradingDna";

/** Tenant-scoped replay including canonical outcomes and learning events. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePaidAccess();
    const { id } = await context.params;
    return NextResponse.json(await replayShadowRecommendation(user.id, id));
  } catch (error) {
    return handleError(error);
  }
}
