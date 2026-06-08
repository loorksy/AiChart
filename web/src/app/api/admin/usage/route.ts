import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { listClaudeUsageForAdmin } from "@/lib/store";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ usage: await listClaudeUsageForAdmin() });
  } catch (err) {
    return handleError(err);
  }
}
