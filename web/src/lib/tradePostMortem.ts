import { callLLM } from "./llm";
import { getIntent, getRecommendation, getTrade } from "./store";
import { insertTradeLesson } from "./tradeMemory";
import { createEmbedding } from "./embeddings";
import type { TradeLessonOutcome } from "./types";

function extractText(content: { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n")
    .trim();
}

function outcomeFromPnl(pnl: number): TradeLessonOutcome {
  if (pnl > 0.01) return "win";
  if (pnl < -0.01) return "loss";
  return "breakeven";
}

function parsePostMortemJson(raw: string): {
  lesson_ar: string;
  tags: string[];
  behavioral_error?: string;
} {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0]! : trimmed) as {
    lesson_ar?: string;
    tags?: string[];
    behavioral_error?: string;
  };
  if (!parsed.lesson_ar) throw new Error("post-mortem missing lesson_ar");
  return {
    lesson_ar: parsed.lesson_ar,
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map(String).slice(0, 8)
      : [],
    behavioral_error: parsed.behavioral_error,
  };
}

/**
 * Async post-close analysis: structured lesson + embedding stored in trade_lessons.
 */
export async function runTradePostMortem(
  userId: number,
  tradeId: number,
  pnl: number,
): Promise<void> {
  const trade = await getTrade(userId, tradeId);
  if (!trade || trade.status !== "closed") return;

  let recommendation = null;
  if (trade.intent_id) {
    const intent = await getIntent(trade.intent_id);
    if (intent?.recommendation_id) {
      recommendation = await getRecommendation(intent.recommendation_id);
    }
  }

  const entryContext = {
    side: trade.side,
    avg_price: trade.avg_price,
    quote_qty: trade.quote_qty,
    entry: recommendation?.entry ?? null,
    stop_loss: recommendation?.stop_loss ?? null,
    take_profit: recommendation?.take_profit ?? null,
    rec_context: recommendation?.context_json
      ? JSON.parse(recommendation.context_json)
      : null,
  };

  const pnlPct =
    trade.quote_qty > 0 ? (pnl / trade.quote_qty) * 100 : 0;
  const outcome = outcomeFromPnl(pnl);

  const system =
    "أنت محلل تداول. بعد إغلاق صفقة، اكتب درساً مختصراً بالعربية (2–4 جمل) يشرح لماذا نجحت/فشلت وما الخطأ السلوكي إن وُجد. أعد JSON فقط: {\"lesson_ar\":\"...\",\"tags\":[\"tag1\"],\"behavioral_error\":\"...\"}";

  const userMsg = [
    `الرمز: ${trade.symbol}`,
    `السوق: ${trade.market}`,
    `الاتجاه: ${trade.side}`,
    `النتيجة: ${outcome}`,
    `PnL: ${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
    recommendation
      ? `التوصية: ${recommendation.action} ثقة ${recommendation.confidence}% · ${recommendation.rationale ?? ""}`
      : "",
    recommendation?.pattern_name
      ? `النمط: ${recommendation.pattern_name}`
      : "",
    `سياق الدخول: ${JSON.stringify(entryContext).slice(0, 1500)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callLLM({
    system,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 600,
  });
  const raw = extractText(res.content);
  const parsed = parsePostMortemJson(raw);

  const embedText = [
    trade.symbol,
    recommendation?.timeframe ?? "",
    recommendation?.pattern_name ?? "",
    parsed.lesson_ar,
    ...parsed.tags,
  ]
    .filter(Boolean)
    .join(" · ");

  const embedding = await createEmbedding(embedText);

  await insertTradeLesson({
    userId,
    tradeId,
    recommendationId: recommendation?.id ?? null,
    symbol: trade.symbol,
    market: trade.market,
    timeframe: recommendation?.timeframe ?? null,
    patternName: recommendation?.pattern_name ?? null,
    outcome,
    pnl,
    pnlPct,
    entryContextJson: JSON.stringify(entryContext),
    lessonAr: parsed.lesson_ar,
    tags: parsed.tags,
    embedding,
  });
}
