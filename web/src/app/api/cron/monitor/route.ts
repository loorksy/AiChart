import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { runMonitorCycle } from "@/lib/monitorRunner";
import { runCronPostScan } from "@/lib/cronPostScan";
import { logAudit } from "@/lib/store";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runMonitorCycle();
  const postScan = await runCronPostScan();
  await logAudit(
    null,
    "cron_monitor",
    JSON.stringify({ ...result, postScan }),
  );

  return NextResponse.json({ ok: true, ...result, postScan });
}
