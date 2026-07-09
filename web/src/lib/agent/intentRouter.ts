/**
 * Intent router — decides which specialist agents a message needs so we don't
 * run (and pay for) the whole fleet on every message. General questions run no
 * market agents; a news question runs only the news agent; chart analysis runs
 * the market fleet. The emitted activity reflects the ACTUAL request, never a
 * fixed generic string, and never shows trading activity for non-trading asks.
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

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

export function routeIntent(input: {
  message: string;
  chartContext?: AgentChartContext;
  ctx: AgentRunContext;
}): AgentIntent[] {
  const text = input.message.toLowerCase();
  const intents: AgentIntent[] = [];

  if (hasAny(text, EXECUTION_WORDS)) intents.push("trade_execution");
  if (hasAny(text, MANAGEMENT_WORDS)) intents.push("trade_management");
  if (hasAny(text, DRAW_WORDS)) intents.push("draw_on_chart");
  if (hasAny(text, TRADING_WORDS)) intents.push("chart_analysis");
  if (hasAny(text, NEWS_WORDS)) intents.push("market_news");
  if (hasAny(text, ACCOUNT_WORDS)) intents.push("account_status");

  if (!intents.length) intents.push("general_question");
  if (intents.length > 1) intents.push("mixed_request");

  // Intent classification is INTERNAL. It must never surface as user-visible
  // activity — a real agent shows work it is actually doing, never canned
  // comprehension narration. Kept as a debug-only signal.
  input.ctx.emitDebug?.({ type: "intent", intents });

  return intents;
}

export function isGeneralOnly(intents: AgentIntent[]): boolean {
  return intents.length === 1 && intents[0] === "general_question";
}

export function needsMarketContext(intents: AgentIntent[]): boolean {
  return (
    intents.includes("chart_analysis") ||
    intents.includes("draw_on_chart") ||
    intents.includes("trade_execution") ||
    intents.includes("trade_management")
  );
}
