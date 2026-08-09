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

/**
 * The bar a recommendation belongs to, as epoch ms, read from the engine's own
 * `source_bar_close_time`.
 *
 * This becomes the key of the per-bar delivery claim on
 * `quant_agent_signal_events`, so it has to be the bar the DECISION was made
 * on. `dispatchMonitorNotification` falls back to bucketing "now" when it is
 * absent — right when nothing better is known, wrong here: a sweep that runs a
 * few seconds after a candle closes buckets into the NEW candle and could
 * deliver the same call twice across the boundary.
 *
 * Unparseable input returns null so that fallback still applies. An invented
 * bar is worse than a bucketed one.
 */
export function recommendationBarTime(sourceBarCloseTime: string | null | undefined): number | null {
  if (!sourceBarCloseTime) return null;
  const parsed = Date.parse(sourceBarCloseTime);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Confidence, converted from the service's scale to the product's.
 *
 * Two scales meet at this seam and getting it wrong prints a number nobody
 * typed. The quant-agent service's `Recommendation.confidence` is a FRACTION
 * (`Field(ge=0.0, le=1.0)`); the signal event's `confidence` column and
 * everything that renders it — the history page's `Math.round(c)%`, the webhook
 * body — are a PERCENTAGE. Passing 0.72 straight through would record a
 * permanent "1%" against a high-confidence call.
 *
 * A non-finite input is null, never 0: "we do not have it" and "we are not
 * confident" are different claims and the log has to be able to tell them
 * apart.
 */
export function recommendationConfidencePercent(fraction: number | null | undefined): number | null {
  if (typeof fraction !== "number" || !Number.isFinite(fraction)) return null;
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
}
