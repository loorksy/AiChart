import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveAgentUserId } from "@/lib/agentAuth";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { generateQuantRecommendation, quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { fetchQuantAgentAnalysisBars, QuantAgentMarketFeedError } from "@/lib/quantAgent/marketFeed";
import {
  isMonitorDue,
  recommendationBarTime,
  recommendationConfidencePercent,
  shouldFireForRecommendation,
} from "@/lib/quantAgent/monitorDue";
import {
  dispatchMonitorNotification,
  type MonitorNotificationOutcome,
} from "@/lib/quantAgent/monitorNotify";
import {
  listEnabledMonitorsGroupedBySymbolInterval,
  markMonitorFired,
  touchMonitorChecked,
  type MonitorRow,
} from "@/lib/quantAgent/monitorStore";
import type { QuantRecommendation } from "@/lib/quantAgent/types";

export const runtime = "nodejs";
export const maxDuration = 290;

const log = createLogger("cron.quant-agent-monitors");

// Same single-leader lease shape as quant-agent-scan's lock, so overlapping
// cron ticks / multiple replicas never double-fire a monitor.
const MONITOR_LOCK_MS = 280_000;

function monitorNotificationText(rec: QuantRecommendation): string {
  const dirLabel = rec.direction === "buy" ? "🟢 شراء · Buy" : "🔴 بيع · Sell";
  const lines = [
    `<b>Quant Agent monitor</b>`,
    `${rec.symbol} · ${rec.interval}`,
    `الاتجاه · Direction: ${dirLabel}`,
    rec.entry != null ? `الدخول · Entry: <code>${rec.entry}</code>` : null,
    `وقف الخسارة · Stop: <code>${rec.stop_loss}</code>`,
    rec.take_profit != null ? `الهدف · Target: <code>${rec.take_profit}</code>` : null,
  ];
  return lines.filter((line): line is string => line != null).join("\n");
}

async function notifyDueMonitor(
  monitor: MonitorRow,
  recommendation: QuantRecommendation,
): Promise<MonitorNotificationOutcome> {
  return dispatchMonitorNotification(monitor.userId, monitor, {
    title: `Quant Agent monitor — ${monitor.symbol} (${monitor.interval})`,
    text: monitorNotificationText(recommendation),
    symbol: monitor.symbol,
    market: recommendation.market,
    recommendationId: recommendation.id,
    interval: monitor.interval,
    direction: recommendation.direction,
    entry: recommendation.entry,
    stopLoss: recommendation.stop_loss,
    takeProfit: recommendation.take_profit,
    // The signal-event row records what the ENGINE decided, so it gets the
    // engine's own confidence, reasoning and bar — not the formatted Telegram
    // message and a clock reading. Nothing here is defaulted: every field is
    // present on the recommendation or the fire is not recorded as having it.
    confidence: recommendationConfidencePercent(recommendation.confidence),
    rationale: recommendation.rationale,
    barTime: recommendationBarTime(recommendation.source_bar_close_time) ?? undefined,
  });
}

/**
 * Scheduled Quant Agent monitor sweep (plan "Feature A — Watchlist + AI
 * Scheduled Monitors" §A3) — mirrors quant-agent-scan's cron-secret + lease
 * lock + candle-fetch + generate-recommendation pattern exactly, but adds a
 * per-monitor due-check (users choose arbitrary intervals, unlike the scan's
 * fixed set) and only notifies monitors whose group's fresh recommendation id
 * differs from their own `last_fired_recommendation_id` — the quant-agent
 * service's own idempotency key means an unchanged symbol/interval returns
 * the SAME id, so this dedupe is also the webhook rate limit (no separate
 * counter table needed).
 *
 * Two further filters live INSIDE `dispatchMonitorNotification`, not here, and
 * this sweep only reports their verdict: the monitor's own firing rule
 * (`always` / `on_change`), and the per-bar delivery claim on
 * `quant_agent_signal_events`. Both are deliberately downstream of this loop —
 * they are properties of a fire, not of a sweep, and putting them here would
 * mean a second caller could bypass them. `fired` therefore counts real
 * deliveries; anything the two filters held back is reported separately.
 *
 * One candle fetch + one generateQuantRecommendation call per (symbol,
 * market, interval) GROUP, however many users are watching it — never
 * touches the canonical `recommendations` table, exactly like the scan cron.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!quantAgentServiceEnabled()) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "QUANT_AGENT_SERVICE_ENABLED is not 1",
    });
  }

  const groups = await listEnabledMonitorsGroupedBySymbolInterval();
  if (!groups.length) {
    return NextResponse.json({ ok: false, skipped: true, reason: "no enabled monitors" });
  }

  const outcome = await withLock("cron:quant-agent-monitors", MONITOR_LOCK_MS, async () => {
    // Candle feed no longer reads any single-operator's linked MT account —
    // recommendations are symbol-scoped, not account-scoped, and the
    // analysis-only feed has no per-user concept at all (plan §4).
    // `resolveAgentUserId()` is kept only for `owner_user_id` attribution on
    // the generated recommendation row below, which still needs SOME
    // identity value; it never reaches the candle fetch anymore.
    const userId = await resolveAgentUserId();

    let groupsChecked = 0;
    let monitorsChecked = 0;
    let fired = 0;
    const suppressed = { unchanged: 0, duplicate: 0 };
    let notifyFailed = 0;
    let groupsFailed = 0;
    let skippedNotDue = 0;

    for (const group of groups) {
      const now = Date.now();
      const dueMonitors = group.monitors.filter((monitor) =>
        isMonitorDue(monitor.lastCheckedAt, group.interval, now),
      );
      skippedNotDue += group.monitors.length - dueMonitors.length;
      if (!dueMonitors.length) continue;

      groupsChecked += 1;
      const requestId = randomUUID();
      try {
        const feed = await fetchQuantAgentAnalysisBars({
          symbol: group.symbol,
          market: group.market,
          interval: group.interval,
        });

        if (!feed.bars.length) {
          for (const monitor of dueMonitors) await touchMonitorChecked(monitor.id, now);
          monitorsChecked += dueMonitors.length;
          continue;
        }

        const recommendation = await generateQuantRecommendation(
          { userId, requestId },
          { symbol: feed.symbol, market: feed.market, interval: feed.interval, bars: feed.bars },
        );
        monitorsChecked += dueMonitors.length;

        for (const monitor of dueMonitors) {
          // Always record the check first — a notify failure below must not
          // leave the monitor looking un-checked and re-trigger a re-fetch
          // next tick.
          await touchMonitorChecked(monitor.id, now);

          if (!recommendation) continue; // "no signal" tick — normal, not a failure
          if (!shouldFireForRecommendation(monitor.lastFiredRecommendationId, recommendation.id)) {
            continue; // same recommendation as last time — nothing changed
          }

          try {
            const outcome = await notifyDueMonitor(monitor, recommendation);
            // The recommendation id is recorded either way: it HAS been seen,
            // and re-offering it next tick would only re-run the suppression.
            await markMonitorFired(monitor.id, recommendation.id, now);
            // `fired` counts deliveries, not attempts. A monitor whose
            // `on_change` rule held, or whose bar was already claimed, sent
            // nothing — counting it here would make the sweep's own telemetry
            // the first thing to lie about whether an alert went out.
            if (outcome.suppressed) suppressed[outcome.suppressed] += 1;
            else fired += 1;
          } catch (error) {
            notifyFailed += 1;
            log.warn("monitor notification failed", {
              monitorId: monitor.id,
              symbol: monitor.symbol,
              interval: monitor.interval,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        groupsFailed += 1;
        const message =
          error instanceof QuantAgentMarketFeedError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        log.warn("quant-agent monitor tick failed", {
          symbol: group.symbol,
          interval: group.interval,
          requestId,
          error: message,
        });
      }
    }

    return {
      groups: groups.length,
      groups_checked: groupsChecked,
      groups_failed: groupsFailed,
      monitors_checked: monitorsChecked,
      monitors_skipped_not_due: skippedNotDue,
      fired,
      suppressed_unchanged: suppressed.unchanged,
      suppressed_duplicate: suppressed.duplicate,
      notify_failed: notifyFailed,
    };
  });

  if (!outcome.ran) {
    // Another instance already holds the lease — skip cleanly (not an error).
    return NextResponse.json({ skipped: true, reason: "locked" });
  }
  return NextResponse.json({ ok: true, ...outcome.result });
}

// GET is convenient for some schedulers; identical auth + behavior.
export const GET = POST;
