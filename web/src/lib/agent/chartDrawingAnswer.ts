import { callLLM, isLLMConfigured } from "@/lib/llm";
import type { AgentChartContext } from "./types";
import { sanitizePublicText } from "./activity";
import { summarizeChartDrawings } from "./chartDrawingContext";
import type { ActiveRecommendation } from "./sessionRecommendation";

export async function answerChartDrawingQuestion(input: {
  userMessage: string;
  chartContext?: AgentChartContext;
  activeRecommendation?: ActiveRecommendation | null;
}): Promise<string> {
  const currentPrice = input.chartContext?.latestCandle?.close ?? null;
  const drawings = summarizeChartDrawings(
    input.chartContext?.drawings,
    currentPrice,
  );

  if (!drawings.length) {
    return "لا أرى رسومات محفوظة داخل حالة هذا الشارت الآن. إذا رسمت بأدوات TradingView الأصلية ولم تُحفظ داخل Lonora فقد لا تصلني كبيانات؛ ارسمها من أدوات Lonora/الوكيل أو احفظ التخطيط ثم اسألني عنها.";
  }

  const context = {
    symbol: input.chartContext?.symbol,
    interval: input.chartContext?.interval,
    currentPrice,
    drawings,
    activeRecommendation: input.activeRecommendation
      ? {
          direction: input.activeRecommendation.direction,
          entry: input.activeRecommendation.entry,
          stopLoss: input.activeRecommendation.stopLoss,
          targets: input.activeRecommendation.targets,
          status: input.activeRecommendation.status,
          invalidationRule: input.activeRecommendation.invalidationRule,
        }
      : null,
  };

  if (!isLLMConfigured()) return fallbackDrawingAnswer(context);

  try {
    const res = await callLLM({
      system:
        "You are the AiChart trading agent discussing drawings on the operator's live chart. Reply naturally and concisely in the SAME language as the operator's question. Do not issue a new buy/sell recommendation unless the operator explicitly asks for analysis or an entry. Use ONLY the JSON provided: the drawings, current price, and active recommendation if present. Never claim to see drawings that are not in the data. Never reveal internal reasoning.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            question: input.userMessage,
            context,
          }),
        },
      ],
      maxTokens: 700,
    });
    const text = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return sanitizePublicText(text) || fallbackDrawingAnswer(context);
  } catch {
    return fallbackDrawingAnswer(context);
  }
}

function fallbackDrawingAnswer(context: {
  symbol?: string;
  interval?: string;
  currentPrice: number | null;
  drawings: ReturnType<typeof summarizeChartDrawings>;
}): string {
  const lines = context.drawings.slice(0, 6).map((d) => {
    const range =
      d.low != null && d.high != null && d.low !== d.high
        ? `${d.low}–${d.high}`
        : `${d.prices[0]}`;
    return `- ${d.label ?? d.role ?? d.type}: ${range}`;
  });
  return [
    `أرى ${context.drawings.length} رسم/مستوى محفوظ على ${context.symbol ?? "الشارت"} ${context.interval ?? ""}.`,
    context.currentPrice ? `السعر الحالي تقريبًا: ${context.currentPrice}.` : "",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}
