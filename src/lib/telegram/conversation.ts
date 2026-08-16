/**
 * How a linked Telegram chat should feel: a conversation, not a card dump.
 *
 * The webhook used to run the full gold engine on every line — including
 * "مرحبا" — then print internal envelope labels. This module decides the
 * turn first, answers greetings and chart-photo asks without a market run,
 * and keeps the analysis path for actual recommendation requests.
 */
import { DATA_SYMBOL, DISPLAY_NAME_AR } from "@/lib/gold";
import { getSessionStatus } from "@/lib/markets/tradingCalendar";
import {
  isGeneralOnly,
  needsMarketContext,
  routeIntent,
} from "@/lib/agent/intentRouter";
import type { AgentRunContext } from "@/lib/agent/types";
import { resolveUserMenuInput } from "@/lib/telegramCommands";

export type TelegramTurnKind =
  | "greeting"
  | "menu"
  | "session"
  | "chart_photo"
  | "analysis"
  | "general";

export type TelegramTurn = {
  kind: TelegramTurnKind;
  /** Text handed to the agent when this turn still needs the brain. */
  message: string;
};

const GREETING = [
  "مرحبا",
  "مرحباً",
  "مرحبا بك",
  "هلا",
  "اهلا",
  "أهلا",
  "السلام عليكم",
  "سلام",
  "صباح الخير",
  "مساء الخير",
  "hi",
  "hello",
  "hey",
  "thanks",
  "thank you",
  "شكرا",
  "شكراً",
  "تسلم",
];

const MENU = ["القائمة", "قائمة", "مساعدة", "help", "menu", "/qaima"];

const CHART_PHOTO = [
  "صورة الشارت",
  "صورة الشارت",
  "ارسل صورة الشارت",
  "أرسل صورة الشارت",
  "ارسل صورة",
  "أرسل صورة",
  "لقطة الشارت",
  "لقطة",
  "screenshot",
  "send chart",
  "chart photo",
  "chart image",
];

const SESSION = ["حالة السوق", "هل السوق مفتوح", "هل السوق مفتوح؟", "هل السوق مفتوح الآن؟"];

function norm(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function eq(text: string, phrase: string): boolean {
  return norm(text).toLocaleLowerCase("ar") === phrase.toLocaleLowerCase("ar");
}

function has(text: string, phrase: string): boolean {
  return norm(text).toLocaleLowerCase("ar").includes(phrase.toLocaleLowerCase("ar"));
}

const noopCtx: AgentRunContext = {
  requestId: "telegram-turn",
  emitActivity: () => {},
};

export function classifyTelegramTurn(raw: string): TelegramTurn {
  const trimmed = norm(raw);
  const mapped = resolveUserMenuInput(trimmed) ?? trimmed;

  if (GREETING.some((p) => eq(trimmed, p) || eq(mapped, p))) {
    return { kind: "greeting", message: mapped };
  }
  if (MENU.some((p) => eq(trimmed, p) || eq(mapped, p))) {
    return { kind: "menu", message: mapped };
  }
  if (SESSION.some((p) => eq(trimmed, p) || eq(mapped, p) || has(mapped, p))) {
    return { kind: "session", message: mapped };
  }
  if (CHART_PHOTO.some((p) => eq(trimmed, p) || eq(mapped, p) || has(mapped, p))) {
    return { kind: "chart_photo", message: mapped };
  }

  const intents = routeIntent({
    message: mapped,
    chartContext: { symbol: DATA_SYMBOL, interval: "15m" },
    ctx: noopCtx,
  });
  if (needsMarketContext(intents) && !isGeneralOnly(intents)) {
    return { kind: "analysis", message: mapped };
  }
  return { kind: "general", message: mapped };
}

export function telegramGreeting(): string {
  const session = getSessionStatus(DATA_SYMBOL);
  const market = session.isOpen
    ? "السوق مفتوح الآن."
    : `${session.reason} أقدر أرسل آخر شارت قبل الإغلاق، والتوصية تنتظر الافتتاح.`;
  return [
    `أهلاً. أنا وكيل ${DISPLAY_NAME_AR} على تليجرام.`,
    market,
    "",
    "اكتب لي أو استخدم الأزرار:",
    "• توصية الذهب",
    "• صورة الشارت",
    "• حالة السوق",
  ].join("\n");
}

export function telegramMenu(): string {
  return telegramGreeting();
}

export function telegramSessionStatus(): string {
  const session = getSessionStatus(DATA_SYMBOL);
  if (session.isOpen) {
    return `السوق مفتوح. اطلب «توصية الذهب» وأحلل ${DISPLAY_NAME_AR} الآن.`;
  }
  return `${session.reason}\nما في حركة سعر تُقرأ الآن. اطلب «صورة الشارت» لآخر لقطة، أو عد عند الافتتاح لتوصية جديدة.`;
}

export function telegramLinkedWelcome(): string {
  return [
    "تم الربط.",
    `اسألني عن ${DISPLAY_NAME_AR} كما تسأل في المنصة — توصية، شرح، أو صورة الشارت.`,
    "الأزرار تحت تختصر الطلب.",
  ].join("\n");
}

export function telegramChartCaption(closed: boolean): string {
  return closed
    ? `${DISPLAY_NAME_AR} · 15م — آخر لقطة قبل الإغلاق.`
    : `${DISPLAY_NAME_AR} · 15م`;
}

export function telegramChartFailed(): string {
  return "ما قدرت أجهّز صورة الشارت الآن. افتح المنصة من الزر، أو أعد المحاولة بعد قليل.";
}

export function telegramPreparingChart(): string {
  return "أحضّر صورة الشارت…";
}

export function telegramAnalyzing(): string {
  return `أحلّل ${DISPLAY_NAME_AR}…`;
}
