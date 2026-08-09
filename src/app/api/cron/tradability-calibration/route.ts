import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { query } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import {
  calibrateTradability,
  type CalibrationRow,
} from "@/lib/recommendations/tradabilityCalibration";

export const maxDuration = 60;

const log = createLogger("cron:tradability-calibration");

/** Bounded sample: the newest graded plans are the ones the limits shaped. */
const SAMPLE_LIMIT = 2000;

/** created_at is epoch ms on PG and may be a datetime string on SQLite. */
function epoch(value: string | number | null): number {
  if (typeof value === "number") return value;
  if (value == null) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface Row {
  id: number;
  timeframe: string | null;
  status: string | null;
  created_at: number | string;
  context_json: string | null;
  triggered_at: number | string | null;
}

/**
 * Nightly read-only report: declared tradability verdicts vs realized
 * activation, per verdict (docs/PLATFORM_AGENT_UPGRADE_PLAN.md §1.5). Feeds
 * tuning of TRADABILITY_LIMITS; changes nothing.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await query<Row>(
    `SELECT r.id, r.timeframe, r.status, r.created_at, r.context_json,
            (SELECT MIN(t.occurred_at) FROM recommendation_transitions t
              WHERE t.recommendation_id = r.id AND t.to_status = 'triggered') AS triggered_at
       FROM recommendations r
      WHERE r.context_json LIKE '%"tradability"%'
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ?`,
    [SAMPLE_LIMIT],
  ).catch((error) => {
    log.warn("calibration query failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [] as Row[];
  });

  const report = calibrateTradability(
    rows.map(
      (row): CalibrationRow => ({
        id: Number(row.id),
        timeframe: row.timeframe ?? "1h",
        status: row.status ?? "active",
        createdAt: epoch(row.created_at),
        contextJson: row.context_json,
        triggeredAt: row.triggered_at == null ? null : epoch(row.triggered_at),
      }),
    ),
  );

  log.info("tradability calibration", {
    sampled: report.sampled,
    ungraded: report.ungraded,
    verdicts: report.verdicts
      .filter((v) => v.total > 0)
      .map((v) => `${v.verdict}:${v.activated}/${v.total}`)
      .join(" "),
  });

  return NextResponse.json({ ok: true, report });
}
