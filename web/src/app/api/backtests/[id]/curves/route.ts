import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { getStrategyBacktest } from "@/lib/strategies/evidence";
import { getResearchCsvArtifact } from "@/lib/research/client";
import { newId } from "@/lib/agent/activity";

/** Cap points shipped to the browser; evenly sampled, endpoints preserved. */
const MAX_POINTS = 600;

function downsample<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const out: T[] = [];
  const step = (rows.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(rows[Math.round(i * step)]!);
  }
  return out;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Equity + rolling-win-rate curves for one backtest, proxied from the research
 * service's CSV artifacts (equity.csv / trades.csv) and downsampled for the
 * browser. Returns { available: false, reason } instead of failing the page
 * when the research service or the artifacts are unreachable.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePaidAccess();
    const { id } = await params;
    const backtestId = Number(id);
    if (!Number.isFinite(backtestId) || backtestId <= 0) {
      return NextResponse.json({ error: "معرّف غير صالح" }, { status: 400 });
    }
    const backtest = await getStrategyBacktest(user.id, backtestId);
    if (!backtest) {
      return NextResponse.json({ error: "الاختبار غير موجود" }, { status: 404 });
    }
    const artifacts = (backtest.metrics as { artifacts?: Record<string, string> })
      ?.artifacts;
    const equityArtifact = artifacts?.equity;
    const tradesArtifact = artifacts?.trades;
    if (!backtest.jobId || !equityArtifact) {
      return NextResponse.json({
        available: false,
        reason: "لا توجد بيانات منحنى محفوظة لهذا الاختبار.",
      });
    }

    const context = { userId: user.id, requestId: newId() };
    let equityRows: Record<string, string>[] = [];
    let tradeRows: Record<string, string>[] = [];
    try {
      equityRows = (
        await getResearchCsvArtifact(context, backtest.jobId, equityArtifact)
      ).rows;
      if (tradesArtifact) {
        tradeRows = (
          await getResearchCsvArtifact(context, backtest.jobId, tradesArtifact)
        ).rows;
      }
    } catch {
      return NextResponse.json({
        available: false,
        reason: "خدمة الأبحاث غير متاحة حالياً — أعد المحاولة لاحقاً.",
      });
    }

    const equity = downsample(equityRows, MAX_POINTS)
      .map((row) => ({
        equity: num(row.equity),
        drawdown: num(row.drawdown) ?? 0,
        time: num(row.time) ?? num(row.timestamp),
      }))
      .filter((p) => p.equity != null);

    // Rolling win rate over the trade sequence (window of 20 closed trades).
    const WINDOW = 20;
    const outcomes = tradeRows
      .map((row) => num(row.net_pnl))
      .filter((v): v is number => v != null)
      .map((pnl) => (pnl > 0 ? 1 : 0));
    const rollingWinRate: { trade: number; winRate: number }[] = [];
    let winsInWindow = 0;
    for (let i = 0; i < outcomes.length; i++) {
      winsInWindow += outcomes[i]!;
      if (i >= WINDOW) winsInWindow -= outcomes[i - WINDOW]!;
      const span = Math.min(i + 1, WINDOW);
      rollingWinRate.push({
        trade: i + 1,
        winRate: winsInWindow / span,
      });
    }

    return NextResponse.json({
      available: true,
      equity,
      rollingWinRate: downsample(rollingWinRate, MAX_POINTS),
      tradeCount: outcomes.length,
    });
  } catch (err) {
    return handleError(err);
  }
}
