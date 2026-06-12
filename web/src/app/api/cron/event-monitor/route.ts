import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { runMonitorCycle } from "@/lib/monitorRunner";
import { logAudit } from "@/lib/store";

export const maxDuration = 300;

/** Event-driven monitor — code-only checks; wakes agent on Telegram events only. */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cycle = await runMonitorCycle();
  await logAudit(
    null,
    "cron_event_monitor",
    `users=${cycle.users} events=${cycle.events.length}`,
  );

  return NextResponse.json({ ok: true, ...cycle });
}
