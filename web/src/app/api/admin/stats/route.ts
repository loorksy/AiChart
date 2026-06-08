import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { getAdminPlatformStats } from "@/lib/store";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ stats: getAdminPlatformStats() });
  } catch (err) {
    return handleError(err);
  }
}
