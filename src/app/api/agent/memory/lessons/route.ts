import { NextRequest, NextResponse } from "next/server";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  searchSimilarLessons,
  listRecentLessons,
} from "@/lib/tradeMemory";
import { queryOne } from "@/lib/db";
import { listValidatedTradeLessons } from "@/lib/recommendations/canonical/tradeLessons";
import type { TradeLesson, TradeLessonMatch } from "@/lib/types";

interface RecommendationLessonContext {
  market_regime: string | null;
  timeframe: string | null;
  action: string;
  confidence: number;
}

function object(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function strings(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function structuredLessons(
  userId: number,
  lessons: Array<TradeLesson | TradeLessonMatch>,
) {
  return Promise.all(
    lessons.map(async (lesson) => {
      const recommendation =
        lesson.recommendation_id == null
          ? null
          : await queryOne<RecommendationLessonContext>(
              `SELECT market_regime, timeframe, action, confidence
                 FROM recommendations WHERE id = ? AND user_id = ?`,
              [lesson.recommendation_id, userId],
            );
      return {
        lesson_id: lesson.id,
        recommendation_id: lesson.recommendation_id,
        trade_id: lesson.trade_id,
        result: {
          outcome: lesson.outcome,
          pnl: Number(lesson.pnl),
          pnl_pct: Number(lesson.pnl_pct),
        },
        strategy: {
          id: lesson.pattern_name ?? "direct_analysis",
        },
        market_context: {
          symbol: lesson.symbol,
          market: lesson.market,
          timeframe: recommendation?.timeframe ?? lesson.timeframe,
          regime: recommendation?.market_regime ?? "unknown",
          direction: recommendation?.action ?? "unknown",
          confidence: recommendation?.confidence ?? null,
          entry: object(lesson.entry_context_json),
        },
        evidence: {
          tags: strings(lesson.tags_json),
          similarity:
            "score" in lesson && Number.isFinite(lesson.score)
              ? Number(lesson.score)
              : null,
          recorded_at: lesson.created_at,
        },
        summary_ar: lesson.lesson_ar,
      };
    }),
  );
}

/**
 * Bridge: semantic search over post-mortem trade lessons.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const symbol = req.nextUrl.searchParams.get("symbol") ?? undefined;
    const pattern = req.nextUrl.searchParams.get("pattern") ?? undefined;
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "3");
    const recentOnly = req.nextUrl.searchParams.get("recent") === "1";

    if (recentOnly) {
      const lessons = await listRecentLessons(userId, limit);
      return NextResponse.json({
        ok: true,
        schema_version: "structured-trade-lessons-v1",
        lessons: await structuredLessons(userId, lessons),
        validated_patterns: await listValidatedTradeLessons(userId, { limit }),
      });
    }

    const lessons = await searchSimilarLessons(userId, {
      symbol,
      pattern,
      limit: Number.isFinite(limit) ? limit : 3,
    });
    return NextResponse.json({
      ok: true,
      schema_version: "structured-trade-lessons-v1",
      lessons: await structuredLessons(userId, lessons),
      validated_patterns: await listValidatedTradeLessons(userId, { limit }),
    });
  } catch (e) {
    return handleError(e);
  }
}
