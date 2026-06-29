import { NextResponse } from "next/server";
import { requireAdmin, handleError } from "@/lib/api";
import { listAuditLogs, listUsersForAdmin } from "@/lib/store";
import { getActiveProvider, isLLMConfigured } from "@/lib/llm";
import { isTelegramConfigured } from "@/lib/telegram";
import { getPlatformValue } from "@/lib/platformConfig";
import { getBinanceCaptureStatus } from "@/lib/binanceChartCapture";

export async function GET() {
  try {
    await requireAdmin();
    const users = await listUsersForAdmin();
    const audit = await listAuditLogs(20);

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      llm: isLLMConfigured(),
      ai_provider: getActiveProvider(),
      telegram: isTelegramConfigured(),
      cron_secret_set: Boolean(getPlatformValue("CRON_SECRET")),
      binance_capture: await getBinanceCaptureStatus(),
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
