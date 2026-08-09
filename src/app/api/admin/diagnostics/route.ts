import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireAdminWith } from "@/lib/adminRoles";
import { query } from "@/lib/db";
import { featureFlagSnapshot } from "@/lib/agent/featureFlags";
import { buildParityReport } from "@/lib/agent/parityLog";
import { metrics } from "@/lib/metrics";

/**
 * One diagnostics view for the plan's dashboards (§17).
 *
 * Read-only, answering one operator question: "is the system holding its own
 * invariants?" The critical counters — hidden WAIT writes, wrong-mode
 * executions, unexplained parity — come first because their correct value is
 * zero, and any other value is a page rather than a trend to watch.
 */
export async function GET() {
  try {
    await requireAdminWith("keys_write");

    const [parity, caseRows, reevalRows] = await Promise.all([
      buildParityReport(50),
      query<{ state: string; count: number | string }>(
        `SELECT CASE WHEN outcome IS NULL THEN 'pending' ELSE 'resolved' END AS state,
                COUNT(*) AS count
           FROM market_cases GROUP BY 1`,
      ).catch(() => []),
      query<{ outcome: string; count: number | string }>(
        `SELECT outcome, COUNT(*) AS count
           FROM recommendation_reevaluations GROUP BY outcome`,
      ).catch(() => []),
    ]);

    // Counters are read back from the Prometheus registry, so this endpoint
    // always agrees with the scrape instead of keeping a second tally.
    const registry = metrics.registry;
    const value = async (name: string): Promise<number> => {
      const metric = registry.getSingleMetric(name);
      if (!metric) return 0;
      const data = await metric.get();
      return data.values.reduce((sum, v) => sum + Number(v.value ?? 0), 0);
    };
    // One kind of the labelled critical counter — plan_edit_outside_revisions
    // has no dedicated counter of its own, only its criticalAlert kind.
    const criticalKind = async (kind: string): Promise<number> => {
      const metric = registry.getSingleMetric("aichart_critical_alerts_total");
      if (!metric) return 0;
      const data = await metric.get();
      return data.values
        .filter((v) => (v.labels as Record<string, unknown> | undefined)?.kind === kind)
        .reduce((sum, v) => sum + Number(v.value ?? 0), 0);
    };

    return NextResponse.json({
      critical: {
        hiddenWaitWrites: await value("aichart_hidden_wait_writes_total"),
        executionInWrongMode: await value("aichart_execution_wrong_mode_total"),
        planEditOutsideRevisions: await criticalKind("plan_edit_outside_revisions"),
        unexplainedParity: parity.totals.unexplained,
        criticalAlerts: await value("aichart_critical_alerts_total"),
      },
      parity: { totals: parity.totals, unpaired: parity.unpaired },
      reevaluation: Object.fromEntries(
        reevalRows.map((row) => [row.outcome, Number(row.count)]),
      ),
      caseMemory: Object.fromEntries(
        caseRows.map((row) => [row.state, Number(row.count)]),
      ),
      counters: {
        completeContracts: await value("aichart_analysis_contracts_total"),
        invalidLevelRecommendations: await value(
          "aichart_invalid_level_recommendations_total",
        ),
        staleRevisionDenials: await value("aichart_stale_revision_denials_total"),
        duplicateNotificationsSuppressed: await value(
          "aichart_duplicate_notifications_total",
        ),
        reevaluationCycles: await value("aichart_reevaluation_cycles_total"),
        reevaluationTriggers: await value(
          "aichart_reevaluation_triggers_total",
        ),
      },
      featureFlags: featureFlagSnapshot(),
    });
  } catch (err) {
    return handleError(err);
  }
}
