import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { runRecommendationSweep } from "@/lib/recommendations/recommendationTracker";

export const runtime = "nodejs";
export const maxDuration = 300;

const log = createLogger("cron.recommendation-sweep");

// Single-leader lease so overlapping cron ticks / multiple replicas never
// double-sweep. Slightly under maxDuration; auto-renewed while the body runs.
const SWEEP_LOCK_MS = 290_000;

/**
 * Scheduled recommendation-tracker sweep. Evaluates every non-terminal tracked
 * recommendation against fresh CLOSED candles from OANDA — the warehouse this
 * once named is gone — persists status/outcome changes, and tells the operator
 * what actually changed. Runs with NO browser session and NO LLM, and it cannot
 * execute anything: this platform issues recommendations and places no orders.
 *
 * Set RECOMMENDATION_ALERTS_SILENT=1 to record events without delivering them —
 * the first rollout window, so the real message volume on a live book can be
 * measured before anyone's phone starts buzzing.
 *
 * Auth: the platform cron secret (Authorization: Bearer <CRON_SECRET> or the
 * `x-cron-secret` header). Overlap-safe via a distributed lease lock. Idempotent
 * and a safe no-op when no recommendations are active.
 *
 * Schedule it with any external scheduler (Vercel cron, a platform cron job, or
 * `curl` from a systemd timer) hitting POST with the cron secret.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const outcome = await withLock("cron:recommendation-sweep", SWEEP_LOCK_MS, () =>
    runRecommendationSweep({
      logger: log,
      silentAlerts: (process.env.RECOMMENDATION_ALERTS_SILENT ?? "").trim() === "1",
    }),
  );

  if (!outcome.ran) {
    // Another instance already holds the lease — skip cleanly (not an error).
    return NextResponse.json({ skipped: true, reason: "locked" });
  }
  return NextResponse.json({ ok: true, ...outcome.result });
}

// GET is convenient for some schedulers; identical auth + behavior.
export const GET = POST;
