import type { AgentConversationContext } from "./types";

const RECOMMENDATION_REFERENCE = /(?:why did you choose|that entry|previous recommendation|same analysis|التوصية السابقة|نفس التحليل|لماذا اخترت|ليش اخترت|عدّل الوقف|عدل الوقف)/iu;
const REDRAW_REFERENCE = /(?:draw it again|same drawing|ارسمها مرة ثانية|نفس الرسم)/iu;

/** Intent-only hints; never passed as market data or as the specialist prompt. */
export function contextualizeIntentMessage(
  userMessage: string,
  context?: AgentConversationContext,
): string {
  if (!context?.activeRecommendation) return userMessage;
  if (REDRAW_REFERENCE.test(userMessage)) return `${userMessage}\n[draw the recommendation]`;
  if (RECOMMENDATION_REFERENCE.test(userMessage)) return `${userMessage}\n[explain recommendation]`;
  return userMessage;
}
