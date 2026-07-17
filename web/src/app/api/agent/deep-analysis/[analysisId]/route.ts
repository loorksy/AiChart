import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { getDeepAnalysisRun } from "@/lib/agent/deepAnalysis/store";
import {
  composeDeepAnalysisUpdate,
  mapProgressToUxPhase,
} from "@/lib/agent/deepAnalysis/composeUpdate";

/**
 * Authenticated BFF for Deep Analysis status.
 * Returns internal progress codes for the client composer — never as raw user labels.
 * The `message` field is already model/composer natural language.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ analysisId: string }> },
) {
  try {
    const user = await requirePaidAccess();
    const { analysisId } = await ctx.params;
    if (!analysisId || analysisId.length > 128) {
      return NextResponse.json({ error: "invalid_analysis_id" }, { status: 400 });
    }

    const run = await getDeepAnalysisRun(user.id, analysisId);
    if (!run) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const phase =
      run.status === "failed" || run.status === "discarded"
        ? "failure"
        : run.status === "completed"
          ? "completion"
          : mapProgressToUxPhase(run.internalProgress, Math.max(0, run.uxUpdateCount - 1));

    let message: string | null = null;
    if (phase) {
      const projection = run.resultProjectionJson
        ? (JSON.parse(run.resultProjectionJson) as Parameters<
            typeof composeDeepAnalysisUpdate
          >[0]["projection"])
        : null;
      message = composeDeepAnalysisUpdate({
        locale: run.locale,
        phase,
        projection,
      }).text;
    }

    return NextResponse.json({
      analysisId: run.analysisId,
      status: run.status,
      /** Internal only — clients must not render this string as UI copy. */
      internalProgress: run.internalProgress,
      message,
      uxUpdateCount: run.uxUpdateCount,
      symbol: run.symbol,
      interval: run.interval,
      completedAt: run.completedAt,
    });
  } catch (error) {
    return handleError(error);
  }
}
