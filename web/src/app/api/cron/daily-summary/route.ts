import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import {
  getLimits,
  getSettings,
  listUsersForDailySummary,
  logAudit,
} from "@/lib/store";
import { sendDailySummary } from "@/lib/dailySummary";

export const maxDuration = 120;

const CRON_LEADER_LOCK_MS = 115_000;

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await withLock("cron:daily-summary", CRON_LEADER_LOCK_MS, async () => {
  const users = await listUsersForDailySummary();
  let sent = 0;
  const errors: string[] = [];

  for (const { id, chatId } of users) {
    try {
      const settings = await getSettings(id);
      const limits = await getLimits(id);
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

  await logAudit(null, "cron_daily_summary", `sent=${sent}`);
  return { sent, total: users.length, errors };
  });

  if (!run.ran) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  return NextResponse.json({ ok: true, ...run.result });
}
