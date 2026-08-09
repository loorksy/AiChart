import type { TradingSettings } from "./types";
import { getSettings } from "./store";

export interface ChatSessionContext {
  response_mode?: "fast" | "expert" | "vision";
  symbol?: string;
}

export interface SessionChange {
  field: string;
  labelAr: string;
  from: string;
  to: string;
}

export interface ApplySessionResult {
  settings: TradingSettings;
  changes: SessionChange[];
}

/** Session UI no longer mutates trading policy. */
export async function applyChatSessionContext(
  userId: number,
  _context: ChatSessionContext,
): Promise<ApplySessionResult> {
  return { settings: await getSettings(userId), changes: [] };
}

export function buildSessionPromptBlock(
  context: ChatSessionContext | undefined,
  _settings: TradingSettings,
): string {
  const responseMode = context?.response_mode ?? "expert";
  const symbol = context?.symbol?.trim().toUpperCase();
  const symbolLine = symbol
    ? `- الزوج الحالي: ${symbol}. استخدمه ما لم يطلب المستخدم زوجاً آخر.`
    : "- إن لم يذكر المستخدم زوجاً، اطلبه باختصار.";
  return `# سياق جلسة الدردشة
- أسلوب التداول ثابت: scalp.
- عمق الرد: ${responseMode}.
${symbolLine}
- اختر BUY أو SELL أو WAIT من الأدلة السوقية المتاحة فقط.
- إعداد Risk per Trade يحدد حجم المركز بعد القرار ولا يغيّر القرار.`;
}
