/**
 * Pure scheduling logic for "AI Scheduled Monitors" (plan §A3) — no DB, no
 * HTTP, no LLM import, so the due-check + dedupe rules are unit-testable
 * without a database. The cron route (`api/cron/quant-agent-monitors`) is
 * the only caller.
 */
import { barDurationMs } from "@/lib/intervals";

/**
 * Whether a monitor is due for a re-check: a fresh monitor (never checked)
 * is always due; otherwise the monitor's own interval sets its cadence — a
 * 15m monitor re-checks every 15m, a 1h monitor every 1h, etc. Per-monitor
 * cadence is genuinely new logic (unlike the scan cron's fixed interval set)
 * because users choose arbitrary intervals.
 */
export function isMonitorDue(
  lastCheckedAt: number | null,
  interval: string,
  now: number = Date.now(),
): boolean {
  if (lastCheckedAt == null) return true;
  return now - lastCheckedAt >= barDurationMs(interval);
}

/**
 * Whether a freshly generated recommendation is new enough to notify on —
 * the quant-agent service's own idempotency key means re-running the same
 * symbol/interval before a new candle closes returns the SAME recommendation
 * id, so comparing ids is a complete "did anything actually change" check
 * and doubles as the monitor's rate limit (plan §A3 — no separate counter
 * table needed).
 */
export function shouldFireForRecommendation(
  lastFiredRecommendationId: string | null,
  newRecommendationId: string,
): boolean {
  return lastFiredRecommendationId !== newRecommendationId;
}
