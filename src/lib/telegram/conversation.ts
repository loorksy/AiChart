/**
 * Telegram COMMANDS, and nothing else.
 *
 * This module used to be a classifier: phrase lists for greetings, the menu,
 * session questions — each mapped to a canned Arabic paragraph. That is a
 * bot's shape, not an agent's: "مرحبا" got the same fixed reply forever, a
 * greeting with one extra word fell through to the full engine, and the
 * canned answers drifted from what the agent would actually say.
 *
 * The classification is gone. Free text goes to the agent — the orchestrator
 * routes conversational vs market itself and GENERATES the reply live, the
 * same as the platform chat. What survives here is the one thing that is
 * legitimately mechanical: explicit commands. `/chart` (and the exact menu
 * strings that mean it) produces a chart photo, which the agent cannot send
 * as prose; the other slash commands expand to the Arabic prompt they have
 * always stood for and ride to the agent like any typed message.
 */
import { DISPLAY_NAME_AR } from "@/lib/gold";
import { resolveUserMenuInput } from "@/lib/telegramCommands";

export type TelegramCommand =
  | { kind: "chart_photo" }
  | { kind: "prompt"; message: string };

/** The agent-action string the chart command expands to (from the menu JSON). */
const CHART_ACTION = "أرسل صورة الشارت";

/**
 * Resolve an EXPLICIT command — a slash command or an exact menu string.
 * Returns null for everything else: free text is the agent's, untouched.
 */
export function resolveTelegramCommand(raw: string): TelegramCommand | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const mapped = resolveUserMenuInput(trimmed);
  if (mapped === CHART_ACTION || trimmed === CHART_ACTION) {
    return { kind: "chart_photo" };
  }
  if (mapped) return { kind: "prompt", message: mapped };
  return null;
}

/** The /start deep-link response — an auth mechanism's receipt, not a reply. */
export function telegramLinkedWelcome(): string {
  return [
    "تم الربط.",
    `اسألني عن ${DISPLAY_NAME_AR} كما تسأل في المنصة — توصية، شرح، أو صورة الشارت.`,
  ].join("\n");
}

/** Caption for the mechanical /chart command's photo. */
export function telegramChartCaption(closed: boolean): string {
  return closed
    ? `${DISPLAY_NAME_AR} · 15م — آخر لقطة قبل الإغلاق.`
    : `${DISPLAY_NAME_AR} · 15م`;
}

/** Failure receipt for the mechanical /chart command. */
export function telegramChartFailed(): string {
  return "ما قدرت أجهّز صورة الشارت الآن. افتح المنصة من الزر، أو أعد المحاولة بعد قليل.";
}
