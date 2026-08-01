import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { listAuditLogs, listUsersForAdmin } from "@/lib/store";
import { getActiveProvider, isLLMConfigured } from "@/lib/llm";
import { isTelegramConfigured } from "@/lib/telegram";
import { getPlatformValue } from "@/lib/platformConfig";

export async function GET() {
  try {
    await requireAdminWith("keys_write");
    const users = await listUsersForAdmin();
    const audit = await listAuditLogs(20);

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      llm: isLLMConfigured(),
      ai_provider: getActiveProvider(),
      telegram: isTelegramConfigured(),
      cron_secret_set: Boolean(getPlatformValue("CRON_SECRET")),
      users: {
        total: users.length,
        active: users.filter((u) => u.status === "active").length,
      },
      recent_audit: audit,
    });
  } catch (err) {
    return handleError(err);
  }
}
