import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { listUsersForDailySummary, logAudit } from "@/lib/store";
import { sendDailySummary } from "@/lib/dailySummary";
import { refreshUserScenarioMemories } from "@/lib/agent/memory/scenarioMemory";

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

  let scenarioBlocks = 0;
  for (const { id, chatId } of users) {
    try {
      await sendDailySummary(chatId, id, 0);
      sent++;
    } catch (e) {
      errors.push(
        `user ${id}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
    // L2 scenario refresh (plan Phase 4): per-symbol realized-outcome blocks
    // rebuilt from canonical analytics. Best-effort — a failure here must
    // never cost anyone their daily summary.
    try {
      scenarioBlocks += await refreshUserScenarioMemories(id);
    } catch (e) {
      errors.push(
        `scenario user ${id}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }

  await logAudit(null, "cron_daily_summary", `sent=${sent} scenario_blocks=${scenarioBlocks}`);
  return { sent, total: users.length, scenarioBlocks, errors };
  });

  if (!run.ran) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  return NextResponse.json({ ok: true, ...run.result });
}
