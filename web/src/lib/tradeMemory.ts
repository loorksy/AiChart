import { getDbBackend, insertReturningId, query, queryOne } from "./db";
import { createEmbedding } from "./embeddings";
import type { MarketType } from "./markets/types";
import type {
  Trade,
  TradeLesson,
  TradeLessonMatch,
  TradeLessonOutcome,
} from "./types";

export const EMBEDDING_DIM = 1536;
export const MEMORY_SCORE_THRESHOLD = 0.75;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as number[];
    return Array.isArray(arr) && arr.length > 0 ? arr : null;
  } catch {
    return null;
  }
}

function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export interface InsertTradeLessonInput {
  userId: number;
  tradeId: number;
  recommendationId?: number | null;
  symbol: string;
  market: MarketType;
  timeframe?: string | null;
  patternName?: string | null;
  outcome: TradeLessonOutcome;
  pnl: number;
  pnlPct: number;
  entryContextJson?: string | null;
  lessonAr: string;
  tags?: string[];
  embedding: number[];
}

export async function insertTradeLesson(
  input: InsertTradeLessonInput,
): Promise<TradeLesson> {
  const tagsJson =
    input.tags && input.tags.length ? JSON.stringify(input.tags) : null;
  const backend = getDbBackend();

  if (backend === "postgres") {
    const id = await insertReturningId(
      `INSERT INTO trade_lessons
         (user_id, trade_id, recommendation_id, symbol, market, timeframe, pattern_name,
          outcome, pnl, pnl_pct, entry_context_json, lesson_ar, tags_json, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::vector)`,
      [
        input.userId,
        input.tradeId,
        input.recommendationId ?? null,
        input.symbol.toUpperCase(),
        input.market,
        input.timeframe ?? null,
        input.patternName ?? null,
        input.outcome,
        input.pnl,
        input.pnlPct,
        input.entryContextJson ?? null,
        input.lessonAr,
        tagsJson,
        vectorLiteral(input.embedding),
      ],
    );
    return (await queryOne<TradeLesson>(
      "SELECT * FROM trade_lessons WHERE id = ?",
      [id],
    ))!;
  }

  const id = await insertReturningId(
    `INSERT INTO trade_lessons
       (user_id, trade_id, recommendation_id, symbol, market, timeframe, pattern_name,
        outcome, pnl, pnl_pct, entry_context_json, lesson_ar, tags_json, embedding_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.tradeId,
      input.recommendationId ?? null,
      input.symbol.toUpperCase(),
      input.market,
      input.timeframe ?? null,
      input.patternName ?? null,
      input.outcome,
      input.pnl,
      input.pnlPct,
      input.entryContextJson ?? null,
      input.lessonAr,
      tagsJson,
      JSON.stringify(input.embedding),
    ],
  );
  return (await queryOne<TradeLesson>(
    "SELECT * FROM trade_lessons WHERE id = ?",
    [id],
  ))!;
}

export async function listRecentLessons(
  userId: number,
  limit = 3,
): Promise<TradeLesson[]> {
  return query<TradeLesson>(
    `SELECT * FROM trade_lessons WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [userId, limit],
  );
}

export interface SearchSimilarLessonsQuery {
  symbol?: string;
  pattern?: string | null;
  snapshot?: Record<string, unknown>;
  limit?: number;
  minScore?: number;
}

export async function searchSimilarLessons(
  userId: number,
  q: SearchSimilarLessonsQuery,
): Promise<TradeLessonMatch[]> {
  const limit = q.limit ?? 3;
  const minScore = q.minScore ?? MEMORY_SCORE_THRESHOLD;
  const parts = [
    q.symbol ? `symbol ${q.symbol}` : "",
    q.pattern ? `pattern ${q.pattern}` : "",
    q.snapshot ? JSON.stringify(q.snapshot).slice(0, 500) : "",
  ].filter(Boolean);
  const queryText = parts.join(" · ") || "trade lessons";
  let queryVec: number[];
  try {
    queryVec = await createEmbedding(queryText);
  } catch {
    return filterBySymbolFallback(userId, q.symbol, limit);
  }

  if (getDbBackend() === "postgres") {
    const rows = await query<TradeLessonMatch>(
      `SELECT *, (1 - (embedding <=> ?::vector)) AS score
       FROM trade_lessons
       WHERE user_id = ? AND embedding IS NOT NULL
       ORDER BY embedding <=> ?::vector
       LIMIT ?`,
      [vectorLiteral(queryVec), userId, vectorLiteral(queryVec), limit * 3],
    );
    return rows.filter((r) => r.score >= minScore).slice(0, limit);
  }

  const rows = await query<TradeLesson>(
    `SELECT * FROM trade_lessons WHERE user_id = ? ORDER BY id DESC LIMIT 200`,
    [userId],
  );
  const scored: TradeLessonMatch[] = [];
  for (const row of rows) {
    const vec = parseEmbedding(row.embedding_json);
    if (!vec) continue;
    const score = cosineSimilarity(queryVec, vec);
    if (score >= minScore) scored.push({ ...row, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 0) return scored.slice(0, limit);
  return filterBySymbolFallback(userId, q.symbol, limit);
}

async function filterBySymbolFallback(
  userId: number,
  symbol: string | undefined,
  limit: number,
): Promise<TradeLessonMatch[]> {
  if (!symbol) return [];
  const rows = await query<TradeLesson>(
    `SELECT * FROM trade_lessons WHERE user_id = ? AND symbol = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, symbol.toUpperCase(), limit],
  );
  return rows.map((r) => ({ ...r, score: 0.8 }));
}

export function formatLessonsForPrompt(lessons: TradeLessonMatch[]): string {
  if (!lessons.length) return "";
  return [
    "دروس مشابهة من صفقات سابقة:",
    ...lessons.map(
      (l) =>
        `- [${l.outcome}] ${l.lesson_ar} (تشابه ${Math.round(l.score * 100)}%)`,
    ),
  ].join("\n");
}

export async function buildTradeHistorySummary(userId: number): Promise<string> {
  const allTrades = await query<Trade>(
    `SELECT * FROM trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );

  if (!allTrades || allTrades.length === 0) {
    return "لا يوجد تاريخ تداولات مسجل لهذا المستخدم بعد.";
  }

  const closedTrades = allTrades.filter((t) => t.status === "closed");
  const openTrades = allTrades.filter((t) => t.status === "open");

  const totalClosed = closedTrades.length;
  const wins = closedTrades.filter((t) => t.pnl > 0).length;
  const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;
  const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  const symbolCounts: Record<string, number> = {};
  for (const t of allTrades) {
    symbolCounts[t.symbol] = (symbolCounts[t.symbol] || 0) + 1;
  }
  const topSymbols = Object.entries(symbolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sym, count]) => `${sym} (${count} صفقات)`)
    .join("، ");

  const recentLines = allTrades.slice(0, 5).map((t) => {
    const pnlLabel =
      t.status === "closed"
        ? `[ربح/خسارة: ${t.pnl.toFixed(2)} USDT]`
        : "[مفتوحة حالياً]";
    return `- صفقة ${t.side === "buy" ? "شراء" : "بيع"} على ${t.symbol} بتاريخ ${t.created_at} ${pnlLabel}`;
  });

  return [
    "# الطبقة 4: ملخص الأداء التاريخي وسجل التداول (المصدر: جدول trades)",
    `- إجمالي الصفقات المغلقة المحللة مؤخراً: ${totalClosed}`,
    `- عدد الصفقات المفتوحة حالياً: ${openTrades.length}`,
    `- نسبة النجاح (Win Rate): ${winRate.toFixed(1)}%`,
    `- إجمالي الربح/الخسارة المحقق (Realized PnL): ${totalPnL.toFixed(2)} USDT`,
    `- الأصول الأكثر تداولاً: ${topSymbols || "لا توجد بعد"}`,
    `- آخر 5 صفقات منفذة:`,
    ...recentLines,
  ].join("\n");
}
