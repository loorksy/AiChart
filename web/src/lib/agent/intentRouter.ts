/**
 * Intent router. It decides which specialist path a message needs so a drawing
 * request cannot accidentally become a full trade recommendation, and a
 * follow-up about "the recommendation" resolves to stored session state.
 */
import type { AgentChartContext, AgentIntent, AgentRunContext } from "./types";

const TRADING_WORDS = [
  "chart",
  "analyze",
  "analysis",
  "setup",
  "trade",
  "long",
  "short",
  "تحليل",
  "حلل",
  "حلّل",
  "شارت",
  "الشارت",
  "ذهب",
  "gold",
  "xau",
  "eurusd",
  "gbpusd",
  "usdjpy",
  "buy",
  "sell",
  "شراء",
  "بيع",
  "دخول",
  "صفقة",
  "فرصة",
  "سعر",
];

const NEWS_WORDS = [
  "news",
  "أخبار",
  "اخبار",
  "خبر",
  "calendar",
  "أجندة",
  "fed",
  "cpi",
  "nfp",
  "fomc",
  "inflation",
  "فيدرالي",
  "تضخم",
  "بيانات",
];

const ACCOUNT_WORDS = [
  "balance",
  "equity",
  "margin",
  "account",
  "رصيد",
  "هامش",
  "حسابي",
  "حساب",
  "صفقاتي",
  "محفظتي",
];

const EXECUTION_WORDS = [
  "execute",
  "open trade",
  "close",
  "modify",
  "pending",
  "نفذ",
  "نفّذ",
  "افتح",
  "اغلق",
  "أغلق",
  "سكر",
  "عدل",
  "عدّل",
  "احجز",
];

const MANAGEMENT_WORDS = [
  "move sl",
  "trailing",
  "breakeven",
  "تحريك",
  "وقف متحرك",
  "إدارة",
  "تعديل الصفقة",
];

const DRAW_WORDS = ["draw", "ارسم", "رسم", "علّم", "علم على الشارت"];

const DRAW_TRENDLINE_PHRASES = [
  "draw trendline",
  "draw trend line",
  "trendline",
  "trend line",
  "ارسم خط الاتجاه",
  "ارسم ترند",
  "خط ترند",
  "خط الاتجاه",
];

const DRAW_SUPPORT_RESISTANCE_PHRASES = [
  "support resistance",
  "support and resistance",
  "ارسم دعم ومقاومة",
  "حدد الدعم والمقاومة",
  "الدعم والمقاومة",
  "دعم ومقاومة",
];

const CLEAR_DRAWINGS_PHRASES = [
  "clear drawings",
  "clear agent drawings",
  "امسح الرسم",
  "امسح رسومات الوكيل",
  "مسح الرسومات",
];

const EXPLAIN_DRAWINGS_PHRASES = [
  "explain drawing",
  "explain drawings",
  "my drawing",
  "the line i drew",
  "what is this line",
  "what is this zone",
  "اشرح الرسم",
  "اشرح الرسومات",
  "الرسم الذي رسمته",
  "الخط الذي رسمته",
  "المنطقة التي رسمتها",
  "ما هذه المنطقة",
  "ما هذا الخط",
  "رأيك في رسمي",
  "رأيك بالرسم",
];

const TRACK_RECOMMENDATION_PHRASES = [
  "recommendation status",
  "where is the recommendation",
  "شو وضع التوصية",
  "وين صارت التوصية",
  "هل دخلت الصفقة",
  "هل ضربت وقف",
  "هل حققت الهدف",
  "تابع حالة التوصية",
];

const EXPLAIN_RECOMMENDATION_PHRASES = [
  "why this recommendation",
  "explain recommendation",
  "based on what",
  "بناء على ماذا هذه التوصية",
  "بناءً على ماذا هذه التوصية",
  "ليش أعطيتني بيع",
  "ليش أعطيتني شراء",
  "اشرح سبب التوصية",
  "التوصية التي انت وضعتها",
  "التوصية التي أنت وضعتها",
  "التوصية الاتي انت وضعته",
  "التوصية السابقة",
];

const CANCEL_RECOMMENDATION_PHRASES = [
  "cancel recommendation",
  "cancel previous",
  "ألغ التوصية",
  "ألغي التوصية",
  "ألغِ هذه التوصية",
  "ألغي السابقة",
  "ألغ السابقة",
  "حلل من جديد",
];

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function hasPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((p) => text.includes(p.toLowerCase()));
}

function hasAnyIntent(intents: AgentIntent[], values: AgentIntent[]): boolean {
  return intents.some((i) => values.includes(i));
}

export function routeIntent(input: {
  message: string;
  chartContext?: AgentChartContext;
  ctx: AgentRunContext;
}): AgentIntent[] {
  const text = input.message.toLowerCase();
  const intents: AgentIntent[] = [];

  if (hasPhrase(text, CLEAR_DRAWINGS_PHRASES)) intents.push("clear_agent_drawings");
  if (hasPhrase(text, CANCEL_RECOMMENDATION_PHRASES)) intents.push("cancel_active_recommendation");
  if (hasPhrase(text, TRACK_RECOMMENDATION_PHRASES)) intents.push("track_active_recommendation");
  if (hasPhrase(text, EXPLAIN_RECOMMENDATION_PHRASES)) intents.push("explain_active_recommendation");
  if (hasPhrase(text, EXPLAIN_DRAWINGS_PHRASES)) intents.push("explain_chart_drawings");
  if (hasPhrase(text, DRAW_TRENDLINE_PHRASES)) intents.push("draw_trendline");
  if (hasPhrase(text, DRAW_SUPPORT_RESISTANCE_PHRASES)) intents.push("draw_support_resistance");

  if (hasAny(text, EXECUTION_WORDS)) intents.push("trade_execution");
  if (hasAny(text, MANAGEMENT_WORDS)) intents.push("trade_management");
  if (
    hasAny(text, DRAW_WORDS) &&
    !hasAnyIntent(intents, [
      "draw_trendline",
      "draw_support_resistance",
      "clear_agent_drawings",
    ])
  ) {
    intents.push("draw_on_chart");
  }
  if (
    hasAny(text, TRADING_WORDS) &&
    !hasAnyIntent(intents, [
      "draw_trendline",
      "draw_support_resistance",
      "draw_poi_zones",
      "clear_agent_drawings",
      "track_active_recommendation",
      "explain_active_recommendation",
      "explain_chart_drawings",
      "cancel_active_recommendation",
    ])
  ) {
    intents.push("new_trade_analysis");
  }
  if (hasAny(text, NEWS_WORDS)) intents.push("market_news");
  if (hasAny(text, ACCOUNT_WORDS)) intents.push("account_status");

  if (!intents.length) intents.push("general_question");
  if (intents.length > 1) intents.push("mixed_request");

  input.ctx.emitDebug?.({ type: "intent", intents });

  return intents;
}

export function isGeneralOnly(intents: AgentIntent[]): boolean {
  return intents.length === 1 && intents[0] === "general_question";
}

export function needsMarketContext(intents: AgentIntent[]): boolean {
  return (
    intents.includes("new_trade_analysis") ||
    intents.includes("chart_analysis") ||
    intents.includes("draw_on_chart") ||
    intents.includes("draw_trendline") ||
    intents.includes("draw_support_resistance") ||
    intents.includes("draw_poi_zones") ||
    intents.includes("trade_execution") ||
    intents.includes("trade_management")
  );
}

export function isDrawingOnly(intents: AgentIntent[]): boolean {
  return (
    hasAnyIntent(intents, [
      "draw_trendline",
      "draw_support_resistance",
      "draw_poi_zones",
      "clear_agent_drawings",
    ]) &&
    !hasAnyIntent(intents, [
      "new_trade_analysis",
      "chart_analysis",
      "trade_execution",
      "trade_management",
    ])
  );
}
