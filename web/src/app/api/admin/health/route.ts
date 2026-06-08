import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import {
  isMasterKillOn,
  listAuditLogs,
  listUsersForAdmin,
} from "@/lib/store";
import { isAnthropicConfigured } from "@/lib/anthropic";
import { isTelegramConfigured } from "@/lib/telegram";

export async function GET() {
  try {
    await requireAdmin();
    const users = listUsersForAdmin();
    const audit = listAuditLogs(20);

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      master_kill: isMasterKillOn(),
      anthropic: isAnthropicConfigured(),
      telegram: isTelegramConfigured(),
      cron_secret_set: Boolean(process.env.CRON_SECRET),
      users: {
        total: users.length,
        active: users.filter((u) => u.status === "active").length,
        with_binance: users.filter((u) => u.has_binance).length,
      },
      recent_audit: audit,
    });
  } catch (err) {
    return handleError(err);
  }
}
