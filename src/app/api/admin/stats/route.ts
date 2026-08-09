import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { getAdminPlatformStats } from "@/lib/store";

export async function GET() {
  try {
    await requireAdminWith("users_read");
    return NextResponse.json({ stats: await getAdminPlatformStats() });
  } catch (err) {
    return handleError(err);
  }
}
