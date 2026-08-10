import { NextRequest, NextResponse } from "next/server";
import { releaseIdentity } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * Liveness probe — process is up and serving. Dependency-free and public so
 * load balancers / container orchestrators / Docker HEALTHCHECK can hit it
 * cheaply without auth or DB access. Exposes the exact running release
 * identity so a stale build/container/process is externally detectable.
 *
 * `?deep=1` adds the internal-scheduler tick status — every candle fetch is
 * live off the user's own account now, so there is no warehouse tail-age to
 * report. Deep mode touches the DB, so keep orchestrator probes on the
 * default shallow mode.
 */
export async function GET(req: NextRequest) {
  const base = {
    status: "ok",
    ts: new Date().toISOString(),
    ...releaseIdentity(),
  };

  if (req.nextUrl.searchParams.get("deep") !== "1") {
    return NextResponse.json(base);
  }

  try {
    const { internalSchedulerStatus } = await import("@/lib/scheduler/internalScheduler");
    return NextResponse.json({
      ...base,
      scheduler: internalSchedulerStatus(),
    });
  } catch (error) {
    return NextResponse.json({
      ...base,
      deepError: error instanceof Error ? error.message : String(error),
    });
  }
}
