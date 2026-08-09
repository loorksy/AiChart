import { NextRequest, NextResponse } from "next/server";
import { releaseIdentity } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * Liveness probe — process is up and serving. Dependency-free and public so
 * load balancers / container orchestrators / Docker HEALTHCHECK can hit it
 * cheaply without auth or DB access. Exposes the exact running release
 * identity so a stale build/container/process is externally detectable.
 *
 * `?deep=1` adds operator diagnostics for the freshness pipeline: warehouse
 * tail age per in-demand series and internal-scheduler tick status — the two
 * things to check first when the agent reports "prices not fresh enough" on
 * a VPS. Deep mode touches the DB, so keep orchestrator probes on the
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
    const [{ internalSchedulerStatus }, { listWarmDemand }, { getCandles }, { barDurationMs }] =
      await Promise.all([
        import("@/lib/scheduler/internalScheduler"),
        import("@/lib/candles/warmDemand"),
        import("@/lib/candles/candleRepository"),
        import("@/lib/intervals"),
      ]);
    const demand = (await listWarmDemand()).slice(0, 12);
    const now = Date.now();
    const series = await Promise.all(
      demand.map(async ({ symbol, interval }) => {
        try {
          const tail = (await getCandles({ symbol, interval, limit: 1 })) as Array<{
            time: number;
          }>;
          const tailTime = tail.at(-1)?.time ?? null;
          const tailMs =
            tailTime == null
              ? null
              : tailTime < 1_000_000_000_000
                ? tailTime * 1000
                : tailTime;
          const barMs = barDurationMs(interval) || 60_000;
          return {
            symbol,
            interval,
            tailAgeSec: tailMs == null ? null : Math.round((now - tailMs) / 1000),
            staleBars: tailMs == null ? null : Math.round((now - tailMs) / barMs),
          };
        } catch {
          return { symbol, interval, tailAgeSec: null, staleBars: null };
        }
      }),
    );
    return NextResponse.json({
      ...base,
      scheduler: internalSchedulerStatus(),
      warehouse: series,
    });
  } catch (error) {
    return NextResponse.json({
      ...base,
      deepError: error instanceof Error ? error.message : String(error),
    });
  }
}
