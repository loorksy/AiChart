import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { listClaudeUsageForAdmin } from "@/lib/store";

export async function GET() {
  try {
    await requireAdminWith("keys_write");
    return NextResponse.json({ usage: await listClaudeUsageForAdmin() });
  } catch (err) {
    return handleError(err);
  }
}
