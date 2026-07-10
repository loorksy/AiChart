import type { AgentOption, AgentDecision } from "./types";

export const GREETING_OPTIONS: AgentOption[] = [
  { id: "analyze_chart", label: "تحليل الشارت الحالي", prompt: "حلّل الشارت الحالي." },
  { id: "draw_trendline", label: "رسم خط الاتجاه", prompt: "ارسم خط الاتجاه." },
  { id: "support_resistance", label: "تحديد الدعم والمقاومة", prompt: "حدّد الدعم والمقاومة." },
  { id: "news_risk", label: "خطر الأخبار", prompt: "تحقق من خطر الأخبار." },
];

export const RECOMMENDATION_OPTIONS: AgentOption[] = [
  { id: "track_recommendation", label: "تابع حالة هذه التوصية", prompt: "شو وضع التوصية؟" },
  { id: "explain_recommendation", label: "اشرح سبب التوصية", prompt: "بناءً على ماذا هذه التوصية؟" },
  { id: "draw_trade_details", label: "ارسم تفاصيل الصفقة", prompt: "ارسم تفاصيل هذه الصفقة." },
  { id: "cancel_recommendation", label: "ألغِ هذه التوصية", prompt: "ألغِ هذه التوصية." },
];

export const DRAWING_OPTIONS: AgentOption[] = [
  { id: "adjust_drawing", label: "عدّل الرسم", prompt: "عدّل الرسم." },
  { id: "clear_drawings", label: "امسح رسومات الوكيل", prompt: "امسح رسومات الوكيل." },
  { id: "analyze_from_drawing", label: "حلّل بناءً على الرسم", prompt: "حلّل الشارت بناءً على الرسم." },
];

export const NO_RECOMMENDATION_OPTIONS: AgentOption[] = [
  { id: "analyze_chart", label: "تحليل الشارت الحالي", prompt: "حلّل الشارت الحالي." },
  { id: "buy_sell_wait", label: "رأي شراء/بيع/انتظار", prompt: "أعطني رأي شراء/بيع/انتظار." },
];

export function contextualOptionsFor(input: {
  decision: AgentDecision;
  hasActiveRecommendation?: boolean;
  drawingOnly?: boolean;
  noActiveRecommendation?: boolean;
}): AgentOption[] | undefined {
  if (input.drawingOnly) return DRAWING_OPTIONS;
  if (input.noActiveRecommendation) return NO_RECOMMENDATION_OPTIONS;
  if (input.decision === "buy" || input.decision === "sell") {
    return RECOMMENDATION_OPTIONS;
  }
  if (input.decision === "informational" && !input.hasActiveRecommendation) {
    return GREETING_OPTIONS;
  }
  return undefined;
}

