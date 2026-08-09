/**
 * Weekly rollout report (docs/UNIFIED_AGENT_PLAN.md §17).
 *
 * During the rollout the operator gets one aggregated message a week: are the
 * invariants holding, how much did the machinery actually run, and did anything
 * critical fire. The report reads two kinds of sources and labels them apart:
 *
 *  - durable tables (revisions, parity, re-evaluations) — true 7-day windows;
 *  - the in-process metrics registry — counters since the last restart, said
 *    so explicitly, because a restarted counter at zero is not a clean week.
 */
import { query } from "@/lib/db";
import { metrics } from "@/lib/metrics";
import { buildParityReport } from "@/lib/agent/parityLog";
import { dispatchAlert } from "@/lib/alerts";
import { listUsersForDailySummary } from "@/lib/store";
import { createLogger } from "@/lib/logger";

const log = createLogger("weekly-report");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeeklyReport {
  generatedAt: number;
  windowDays: 7;
  critical: {
    hiddenWaitWrites: number;
    executionInWrongMode: number;
    unexplainedParity: number;
    criticalAlerts: number;
  };
  week: {
    revisionsBySource: Record<string, number>;
    reevaluationsByOutcome: Record<string, number>;
    parityRows: number;
  };
  sinceRestart: {
    completeContracts: number;
    staleRevisionDenials: number;
    duplicateNotificationsSuppressed: number;
    reevaluationCycles: number;
    invalidLevelRecommendations: number;
  };
}

async function counter(name: string): Promise<number> {
  const metric = metrics.registry.getSingleMetric(name);
  if (!metric) return 0;
  const data = await metric.get();
  return data.values.reduce((sum, v) => sum + Number(v.value ?? 0), 0);
}

export async function buildWeeklyReport(now = Date.now()): Promise<WeeklyReport> {
  const since = now - WEEK_MS;

  const [revisionRows, reevalRows, parityCountRow, parity] = await Promise.all([
    query<{ source: string; count: number | string }>(
      `SELECT source, COUNT(*) AS count FROM recommendation_revisions
        WHERE created_at >= ? GROUP BY source`,
      [since],
    ).catch(() => []),
    query<{ outcome: string; count: number | string }>(
      `SELECT outcome, COUNT(*) AS count FROM recommendation_reevaluations
        WHERE created_at >= ? GROUP BY outcome`,
      [since],
    ).catch(() => []),
    query<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM decision_parity WHERE created_at >= ?`,
      [since],
    ).catch(() => [{ count: 0 }]),
    buildParityReport(200),
  ]);

  return {
    generatedAt: now,
    windowDays: 7,
    critical: {
      hiddenWaitWrites: await counter("aichart_hidden_wait_writes_total"),
      executionInWrongMode: await counter("aichart_execution_wrong_mode_total"),
      unexplainedParity: parity.totals.unexplained,
      criticalAlerts: await counter("aichart_critical_alerts_total"),
    },
    week: {
      revisionsBySource: Object.fromEntries(
        revisionRows.map((r) => [r.source, Number(r.count)]),
      ),
      reevaluationsByOutcome: Object.fromEntries(
        reevalRows.map((r) => [r.outcome, Number(r.count)]),
      ),
      parityRows: Number(parityCountRow[0]?.count ?? 0),
    },
    sinceRestart: {
      completeContracts: await counter("aichart_analysis_contracts_total"),
      staleRevisionDenials: await counter("aichart_stale_revision_denials_total"),
      duplicateNotificationsSuppressed: await counter(
        "aichart_duplicate_notifications_total",
      ),
      reevaluationCycles: await counter("aichart_reevaluation_cycles_total"),
      invalidLevelRecommendations: await counter(
        "aichart_invalid_level_recommendations_total",
      ),
    },
  };
}

function formatReport(report: WeeklyReport): string {
  const c = report.critical;
  const criticalClean =
    c.hiddenWaitWrites === 0 &&
    c.executionInWrongMode === 0 &&
    c.unexplainedParity === 0 &&
    c.criticalAlerts === 0;
  const lines: string[] = [
    "📊 <b>تقرير Lonora الأسبوعي</b>",
    "",
    criticalClean
      ? "✅ المؤشرات الحرجة كلها صفر (كتابة WAIT خفية، تنفيذ بوضع خاطئ، اختلاف سطحين غير مفسر، إنذارات حرجة)."
      : `🚨 مؤشرات حرجة غير صفرية: WAIT خفي=${c.hiddenWaitWrites}، تنفيذ بوضع خاطئ=${c.executionInWrongMode}، اختلاف غير مفسر=${c.unexplainedParity}، إنذارات=${c.criticalAlerts}.`,
    "",
    "<b>آخر 7 أيام (من الجداول):</b>",
    `• نسخ التوصيات: ${
      Object.entries(report.week.revisionsBySource)
        .map(([s, n]) => `${s}=${n}`)
        .join("، ") || "لا نسخ"
    }`,
    `• دورات إعادة التقييم: ${
      Object.entries(report.week.reevaluationsByOutcome)
        .map(([s, n]) => `${s}=${n}`)
        .join("، ") || "لا دورات"
    }`,
    `• سجلات المساواة بين السطحين: ${report.week.parityRows}`,
    "",
    "<b>منذ آخر تشغيل (عدّادات العملية):</b>",
    `• عقود تحليل مكتملة: ${report.sinceRestart.completeContracts}`,
    `• رفض نسخة قديمة (stale_revision): ${report.sinceRestart.staleRevisionDenials}`,
    `• إشعارات مكررة مُنعت: ${report.sinceRestart.duplicateNotificationsSuppressed}`,
    `• توصيات بمستويات غير صالحة: ${report.sinceRestart.invalidLevelRecommendations}`,
  ];
  return lines.join("\n");
}

/** Send the weekly report to every operator with Telegram configured. */
export async function sendWeeklyReports(): Promise<{ sent: number; errors: string[] }> {
  const report = await buildWeeklyReport();
  const text = formatReport(report);
  const users = await listUsersForDailySummary().catch(() => []);
  let sent = 0;
  const errors: string[] = [];
  for (const { id } of users) {
    try {
      await dispatchAlert(id, {
        type: "signal",
        title: "تقرير Lonora الأسبوعي",
        text,
        symbol: null,
      });
      sent += 1;
    } catch (error) {
      errors.push(`user ${id}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  log.info("weekly report dispatched", { sent, errors: errors.length });
  return { sent, errors };
}
