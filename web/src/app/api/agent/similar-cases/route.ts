import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { ApiError, handleError } from "@/lib/api";
import { getCandles } from "@/lib/candles/candleRepository";
import { detectChartGeometry } from "@/lib/chart/geometry";
import { normalizeCanonicalInterval } from "@/lib/markets/intervals";
import { fingerprintAt } from "@/lib/marketMemory/caseFingerprint";
import { collectCaseEvidence } from "@/lib/marketMemory/caseQuery";

const bodySchema = z
  .object({
    symbol: z.string().min(3).max(16),
    interval: z.string().min(2).max(4),
    /**
     * Ask about a past moment instead of now. Cases at or after it are excluded,
     * so a historical question gets the answer that was available at the time.
     */
    at_ms: z.number().int().positive().optional(),
    min_similarity: z.number().min(0.5).max(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

/**
 * "When has this market looked like this before, and what happened next?"
 *
 * Fingerprints the moment from warehouse candles and returns the aggregated
 * outcomes for BOTH directions. Read-only evidence: nothing here creates,
 * changes, or gates a recommendation.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    void userId;
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const interval = normalizeCanonicalInterval(body.interval);

    const candles = await getCandles({
      symbol: body.symbol,
      interval,
      toMs: body.at_ms,
      limit: 200,
    });
    const fingerprint = fingerprintAt(candles);
    if (!fingerprint) {
      throw new ApiError(
        422,
        "لا توجد شموع كافية في المستودع لوصف هذه اللحظة بنيوياً.",
      );
    }

    const geometry = detectChartGeometry({ candles });
    const evidence = await collectCaseEvidence({
      symbol: body.symbol,
      interval,
      fingerprint,
      patternName: geometry.patterns[0]?.patternType ?? null,
      beforeMs: body.at_ms,
    });

    if (!evidence) {
      return NextResponse.json({
        symbol: body.symbol,
        interval,
        fingerprint,
        found: false,
        // Said plainly so the caller reports absence instead of inventing a rate.
        note: "لا توجد حالات تاريخية مشابهة مفهرسة لهذا الرمز والفريم — التحليل مباشر.",
      });
    }

    return NextResponse.json({
      symbol: body.symbol,
      interval,
      found: true,
      ...evidence,
    });
  } catch (err) {
    return handleError(err);
  }
}
