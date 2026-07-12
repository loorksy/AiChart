import type { AgentOption, AgentDecision } from "./types";
import type { AppLocale } from "@/lib/i18n";

/**
 * Contextual follow-up options offered after a reply. Labels + prompts are
 * localized; the prompts use wording the intent router recognizes in both
 * Arabic and English so a click routes correctly regardless of locale. These
 * are replaced by dynamic, model-generated suggestions in a later tranche.
 */
type OptionSet = Record<AppLocale, AgentOption[]>;

const GREETING_OPTIONS: OptionSet = {
  ar: [
    { id: "analyze_chart", label: "تحليل الشارت الحالي", prompt: "حلّل الشارت الحالي." },
    { id: "draw_trendline", label: "رسم خط الاتجاه", prompt: "ارسم خط الاتجاه." },
    { id: "support_resistance", label: "تحديد الدعم والمقاومة", prompt: "حدّد الدعم والمقاومة." },
    { id: "news_risk", label: "خطر الأخبار", prompt: "تحقق من خطر الأخبار." },
  ],
  en: [
    { id: "analyze_chart", label: "Analyze the current chart", prompt: "Analyze the current chart." },
    { id: "draw_trendline", label: "Draw a trendline", prompt: "Draw a trendline." },
    { id: "support_resistance", label: "Mark support and resistance", prompt: "Mark support and resistance." },
    { id: "news_risk", label: "News risk", prompt: "Check the news risk." },
  ],
};

const RECOMMENDATION_OPTIONS: OptionSet = {
  ar: [
    { id: "track_recommendation", label: "تابع حالة هذه التوصية", prompt: "شو وضع التوصية؟" },
    { id: "explain_recommendation", label: "اشرح سبب التوصية", prompt: "بناءً على ماذا هذه التوصية؟" },
    { id: "draw_trade_details", label: "ارسم تفاصيل الصفقة", prompt: "ارسم تفاصيل هذه الصفقة." },
    { id: "cancel_recommendation", label: "ألغِ هذه التوصية", prompt: "ألغِ هذه التوصية." },
  ],
  en: [
    { id: "track_recommendation", label: "Track this recommendation", prompt: "recommendation status" },
    { id: "explain_recommendation", label: "Explain the recommendation", prompt: "explain recommendation" },
    { id: "draw_trade_details", label: "Draw the trade details", prompt: "draw trade details" },
    { id: "cancel_recommendation", label: "Cancel this recommendation", prompt: "cancel recommendation" },
  ],
};

const DRAWING_OPTIONS: OptionSet = {
  ar: [
    { id: "adjust_drawing", label: "عدّل الرسم", prompt: "عدّل الرسم." },
    { id: "clear_drawings", label: "امسح رسومات الوكيل", prompt: "امسح رسومات الوكيل." },
    { id: "analyze_from_drawing", label: "حلّل بناءً على الرسم", prompt: "حلّل الشارت بناءً على الرسم." },
  ],
  en: [
    { id: "adjust_drawing", label: "Adjust the drawing", prompt: "Adjust the drawing." },
    { id: "clear_drawings", label: "Clear agent drawings", prompt: "clear agent drawings" },
    { id: "analyze_from_drawing", label: "Analyze based on the drawing", prompt: "Analyze based on the drawing." },
  ],
};

const NO_RECOMMENDATION_OPTIONS: OptionSet = {
  ar: [
    { id: "analyze_chart", label: "تحليل الشارت الحالي", prompt: "حلّل الشارت الحالي." },
    { id: "buy_sell_wait", label: "رأي شراء/بيع/انتظار", prompt: "أعطني رأي شراء/بيع/انتظار." },
  ],
  en: [
    { id: "analyze_chart", label: "Analyze the current chart", prompt: "Analyze the current chart." },
    { id: "buy_sell_wait", label: "Buy / sell / wait opinion", prompt: "Give me a buy/sell/wait opinion." },
  ],
};

function pick(set: OptionSet, locale: AppLocale): AgentOption[] {
  return set[locale] ?? set.ar;
}

export function contextualOptionsFor(input: {
  decision: AgentDecision;
  hasActiveRecommendation?: boolean;
  drawingOnly?: boolean;
  noActiveRecommendation?: boolean;
  locale?: AppLocale;
}): AgentOption[] | undefined {
  const locale = input.locale ?? "ar";
  if (input.drawingOnly) return pick(DRAWING_OPTIONS, locale);
  if (input.noActiveRecommendation) return pick(NO_RECOMMENDATION_OPTIONS, locale);
  if (input.decision === "buy" || input.decision === "sell") {
    return pick(RECOMMENDATION_OPTIONS, locale);
  }
  if (input.decision === "informational" && !input.hasActiveRecommendation) {
    return pick(GREETING_OPTIONS, locale);
  }
  return undefined;
}
