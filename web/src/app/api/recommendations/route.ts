import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { listRecommendations } from "@/lib/store";

export async function GET() {
  try {
    const user = await requirePlatformAccess();
    return NextResponse.json({
      recommendations: await listRecommendations(user.id, 30),
    });
  } catch (err) {
    return handleError(err);
  }
}
