import { NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { listRecommendations } from "@/lib/store";

export async function GET() {
  try {
    const user = await requirePaidAccess();
    return NextResponse.json({
      recommendations: await listRecommendations(user.id, 30),
    });
  } catch (err) {
    return handleError(err);
  }
}
