import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { runScalpCycle } from "@/lib/scalpEngine";
import { logAudit } from "@/lib/store";

export const maxDuration = 300;

/**
 * Autonomous scalp loop tick. A scheduler hits this frequently (≤1m via system
 * cron, or sub-minute via a pm2 ticker). One tick runs a full cycle for every
 * active scalp session. Execution stays behind executeIntent → Risk Guard.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cycle = await runScalpCycle();
  await logAudit(
    null,
    "cron_scalp",
    `sessions=${cycle.sessions} events=${cycle.events.length} errors=${cycle.errors.length}`,
  );

  return NextResponse.json({ ok: true, ...cycle });
}
