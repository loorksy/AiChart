import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { listUsersForAdmin } from "@/lib/store";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ users: await listUsersForAdmin() });
  } catch (err) {
    return handleError(err);
  }
}
