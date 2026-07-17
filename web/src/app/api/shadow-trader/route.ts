import { NextRequest, NextResponse } from "next/server";
import { handleError, requirePaidAccess } from "@/lib/api";
import { listShadowRecommendations } from "@/lib/tradingDna";

/** Read-only list. Shadow generation is an internal research operation. */
export async function GET(request: NextRequest) {
  try {
    const user = await requirePaidAccess();
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    return NextResponse.json({
      recommendations: await listShadowRecommendations(
        user.id,
        Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 50,
      ),
    });
  } catch (error) {
    return handleError(error);
  }
}
