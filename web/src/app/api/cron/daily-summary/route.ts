import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import {
  getLimits,
  getSettings,
  listUsersForDailySummary,
  logAudit,
} from "@/lib/store";
import { sendDailySummary } from "@/lib/dailySummary";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = listUsersForDailySummary();
  let sent = 0;
  const errors: string[] = [];

  for (const { id, chatId } of users) {
    try {
      const settings = getSettings(id);
      const limits = getLimits(id);
      const capital =
        limits.max_capital_cap > 0
          ? Math.min(settings.max_capital, limits.max_capital_cap)
          : settings.max_capital;
      await sendDailySummary(chatId, id, capital);
      sent++;
    } catch (e) {
      errors.push(
        `user ${id}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }

  logAudit(null, "cron_daily_summary", `sent=${sent}`);
  return NextResponse.json({ ok: true, sent, total: users.length, errors });
}
