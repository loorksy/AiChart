import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { listUsersForAdmin } from "@/lib/store";

export async function GET() {
  try {
    await requireAdminWith("users_read");
    return NextResponse.json({ users: await listUsersForAdmin() });
  } catch (err) {
    return handleError(err);
  }
}
