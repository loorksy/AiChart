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
  // Recommendation-request wording (routes into analysis unless a follow-up
  // intent — explain/track/cancel/draw — already claimed the message).
  "توصية",
  "توصيه",
  "سيجنال",
  "signal",
  "recommendation",
];

/** Scalp-specific wording — routes to the stricter scalp recommendation mode. */
const SCALP_WORDS = [
  "scalp",
  "scalping",
  "سكالب",
  "سكلب",
];

const SCALP_PHRASES = [
  "scalp setup",
  "scalping recommendation",
  "scalp recommendation",
  "توصية سكالب",
  "سكالب سريع",
  "صفقة سكالب",
];

/** Draw the STORED active recommendation (entry/SL/TP/invalidation) — never
 *  recompute a fresh trade. Kept ahead of generic drawing so "ارسم التوصية"
 *  cannot fall through to a new Buy/Sell analysis. */
const DRAW_ACTIVE_RECOMMENDATION_PHRASES = [
  "draw the recommendation",
  "draw recommendation",
  "draw trade details",
  "draw the setup",
  "draw entry stop targets",
  "ارسم التوصية",
  "ارسم تفاصيل الصفقة",
  "ارسم تفاصيل التوصية",
  "ارسم تفاصيل هذه التوصية",
  "ارسم هذه التوصية",
  "ارسم الصفقة",
  "ارسم منطقة الدخول والوقف والأهداف",
  "ارسم منطقة الدخول",
  "ارسم التحليل",
  "ارسم السيناريو",
];

/** Re-analyze wording that must survive a "cancel the previous" request so the
 *  agent cancels and then runs a fresh analysis instead of stopping. */
const REANALYZE_PHRASES = [
  "حلل من جديد",
  "حلّل من جديد",
  "وحلل",
  "وحلّل",
  "حلل الشارت",
  "analyze again",
  "analyze the chart",
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

/** Words that reference the USER's own manual drawings (not agent drawings). */
const USER_DRAWING_REF = [
  "رسمي",
  "رسومي",
  "رسوماتي",
  "رسوماتى",
  "منطقتي",
  "خطي",
  "الخط الذي رسمته",
  "الخط اللي رسمته",
  "المنطقة التي رسمتها",
  "المنطقة اللي رسمتها",
  "الترند الذي رسمته",
  "هذا الخط",
  "هذه المنطقة",
  "هذا الترند",
  "هالخط",
  "هالمنطقة",
  "my drawing",
  "my drawings",
  "my line",
  "my zone",
  "my trendline",
  "my support",
  "my resistance",
  "the line i drew",
  "the zone i drew",
  "i drew",
];

const DELETE_WORDS = ["احذف", "امسح", "delete", "remove"];
const MOVE_WORDS = ["حرّك", "حرك", "انقل", "move"];
const MODIFY_WORDS = [
  "عدّل", "عدل", "وسّع", "وسع", "ضيّق", "ضيق",
  "غيّر مستوى", "غير مستوى", "غيّر الخط", "اربط",
  "adjust", "resize", "widen", "narrow", "change the level", "change level",
  "connect",
];
const ANALYZE_WITH_DRAWINGS_PHRASES = [
  "بناءً على رسوماتي",
  "بناء على رسوماتي",
  "حلل بناء على رسمي",
  "على رسوماتي",
  "using my drawings",
  "based on my drawings",
  "with my drawings",
  "analyze my drawings",
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

  // A "cancel the previous AND analyze again" request must not stop at the
  // cancellation — it cancels, then runs a fresh analysis.
  const wantsReanalyze = hasPhrase(text, REANALYZE_PHRASES);

  if (hasPhrase(text, CLEAR_DRAWINGS_PHRASES)) intents.push("clear_agent_drawings");
  if (hasPhrase(text, CANCEL_RECOMMENDATION_PHRASES)) intents.push("cancel_active_recommendation");
  if (hasPhrase(text, TRACK_RECOMMENDATION_PHRASES)) intents.push("track_active_recommendation");
  if (hasPhrase(text, EXPLAIN_RECOMMENDATION_PHRASES)) intents.push("explain_active_recommendation");
  if (hasPhrase(text, EXPLAIN_DRAWINGS_PHRASES)) intents.push("explain_chart_drawings");

  // --- User-drawing understanding / editing (never triggers a trade) ---
  // "Analyze based on my drawings" runs analysis WITH the user's drawing context.
  if (hasPhrase(text, ANALYZE_WITH_DRAWINGS_PHRASES)) {
    intents.push("analyze_with_user_drawings");
  }
  const refsUserDrawing = hasAny(text, USER_DRAWING_REF);
  const editsAgentDrawings = text.includes("الوكيل") || text.includes("agent");
  if (
    refsUserDrawing &&
    !editsAgentDrawings &&
    !hasAnyIntent(intents, ["analyze_with_user_drawings"])
  ) {
    if (hasAny(text, DELETE_WORDS)) intents.push("delete_user_drawing");
    else if (hasAny(text, MOVE_WORDS)) intents.push("move_user_drawing");
    else if (hasAny(text, MODIFY_WORDS)) intents.push("modify_user_drawing");
    else intents.push("discuss_user_drawing");
  }
  const editsUserDrawing = hasAnyIntent(intents, [
    "discuss_user_drawing",
    "modify_user_drawing",
    "move_user_drawing",
    "delete_user_drawing",
  ]);

  // Draw the STORED recommendation — checked before generic draw/trade so it
  // can never fall through to a new Buy/Sell analysis.
  if (hasPhrase(text, DRAW_ACTIVE_RECOMMENDATION_PHRASES)) {
    intents.push("draw_active_recommendation");
  }
  if (hasPhrase(text, DRAW_TRENDLINE_PHRASES)) intents.push("draw_trendline");
  if (hasPhrase(text, DRAW_SUPPORT_RESISTANCE_PHRASES)) intents.push("draw_support_resistance");

  // A user-drawing edit/discuss/delete must never fall through to execution,
  // management, or a new trade — even though wording like "عدّل" overlaps.
  if (hasAny(text, EXECUTION_WORDS) && !editsUserDrawing) intents.push("trade_execution");
  if (hasAny(text, MANAGEMENT_WORDS) && !editsUserDrawing) intents.push("trade_management");
  if (
    hasAny(text, DRAW_WORDS) &&
    !hasAnyIntent(intents, [
      "draw_active_recommendation",
      "draw_trendline",
      "draw_support_resistance",
      "clear_agent_drawings",
    ])
  ) {
    intents.push("draw_on_chart");
  }

  // Scalp wording routes to the stricter scalp recommendation mode rather than
  // the standard trade analysis.
  const wantsScalp = hasPhrase(text, SCALP_PHRASES) || hasAny(text, SCALP_WORDS);
  const tradeExclusions: AgentIntent[] = [
    "draw_active_recommendation",
    "draw_on_chart",
    "draw_trendline",
    "draw_support_resistance",
    "draw_poi_zones",
    "clear_agent_drawings",
    "track_active_recommendation",
    "explain_active_recommendation",
    "explain_chart_drawings",
    "discuss_user_drawing",
    "modify_user_drawing",
    "move_user_drawing",
    "delete_user_drawing",
  ];
  const tradeSignal =
    hasAny(text, TRADING_WORDS) || wantsScalp || wantsReanalyze;
  // A cancel+reanalyze request keeps analyzing; a plain cancel does not.
  const cancelBlocksTrade =
    intents.includes("cancel_active_recommendation") && !wantsReanalyze;
  if (
    tradeSignal &&
    !hasAnyIntent(intents, tradeExclusions) &&
    !cancelBlocksTrade
  ) {
    intents.push(wantsScalp ? "scalp_recommendation" : "new_trade_analysis");
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

/** A user-drawing discuss/modify/move/delete intent (never a trade). */
export function isUserDrawingEdit(intents: AgentIntent[]): boolean {
  return hasAnyIntent(intents, [
    "discuss_user_drawing",
    "modify_user_drawing",
    "move_user_drawing",
    "delete_user_drawing",
    "clarify_drawing_reference",
  ]);
}

export function isUserDrawingMutation(intents: AgentIntent[]): boolean {
  return hasAnyIntent(intents, [
    "modify_user_drawing",
    "move_user_drawing",
    "delete_user_drawing",
  ]);
}

export function needsMarketContext(intents: AgentIntent[]): boolean {
  return (
    intents.includes("new_trade_analysis") ||
    intents.includes("scalp_recommendation") ||
    intents.includes("analyze_with_user_drawings") ||
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
      "draw_on_chart",
      "draw_trendline",
      "draw_support_resistance",
      "draw_poi_zones",
      "clear_agent_drawings",
    ]) &&
    !hasAnyIntent(intents, [
      "new_trade_analysis",
      "scalp_recommendation",
      "chart_analysis",
      "trade_execution",
      "trade_management",
    ])
  );
}

/** True when the user wants the STORED recommendation drawn (never recomputed). */
export function isDrawActiveRecommendation(intents: AgentIntent[]): boolean {
  return (
    intents.includes("draw_active_recommendation") &&
    !hasAnyIntent(intents, [
      "new_trade_analysis",
      "scalp_recommendation",
      "trade_execution",
      "trade_management",
    ])
  );
}

/** True when the message is a scalp recommendation request. */
export function isScalpRecommendation(intents: AgentIntent[]): boolean {
  return intents.includes("scalp_recommendation");
}
