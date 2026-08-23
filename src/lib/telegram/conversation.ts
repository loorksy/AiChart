/**
 * Telegram COMMANDS, and nothing else.
 *
 * This module used to be a classifier: phrase lists for greetings, the menu,
 * session questions — each mapped to a canned Arabic paragraph. That is a
 * bot's shape, not an agent's: a greeting got the same fixed reply forever, a
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
 *
 * The command VOCABULARY is Arabic (the menu JSON is what a user types); the
 * command's ANSWER is not. Every receipt this module renders takes the acting
 * account's locale, because language belongs to the person and not to the
 * channel they happened to open.
 */
import { DISPLAY_NAME_AR, DISPLAY_NAME_EN } from "@/lib/gold";
import { t, type AppLocale } from "@/lib/i18n";
import {
  ACCOUNT_ACTION,
  CHART_ACTION,
  LANGUAGE_ACTION,
  MODEL_ACTION,
  resolveUserMenuInput,
} from "@/lib/telegramCommands";

export type TelegramCommand =
  | { kind: "chart_photo" }
  | { kind: "model_menu" }
  | { kind: "language_menu" }
  | { kind: "account_status" }
  | { kind: "prompt"; message: string };

/** The instrument's name in the reader's language, never a pinned one. */
function goldName(locale: AppLocale): string {
  return locale === "ar" ? DISPLAY_NAME_AR : DISPLAY_NAME_EN;
}

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
  // Mechanical like /chart: the model menu renders a keyboard, not prose.
  if (mapped === MODEL_ACTION || trimmed === MODEL_ACTION) {
    return { kind: "model_menu" };
  }
  // Mechanical too, and for the same reason: picking a language is a keyboard
  // of two buttons that writes the ACCOUNT's preference — never agent prose.
  if (mapped === LANGUAGE_ACTION || trimmed === LANGUAGE_ACTION) {
    return { kind: "language_menu" };
  }
  // Mechanical too: account status is FACTS (state, balance, trial/expiry),
  // composed from the same summary the web badge reads — never agent prose.
  if (mapped === ACCOUNT_ACTION || trimmed === ACCOUNT_ACTION) {
    return { kind: "account_status" };
  }
  if (mapped) return { kind: "prompt", message: mapped };
  return null;
}

/** The /start deep-link response — an auth mechanism's receipt, not a reply. */
export function telegramLinkedWelcome(locale: AppLocale): string {
  return t(locale, "tg.linked_welcome", { name: goldName(locale) });
}

/** Caption for the mechanical /chart command's photo. */
export function telegramChartCaption(closed: boolean, locale: AppLocale): string {
  return closed
    ? t(locale, "tg.chart_caption_closed", { name: goldName(locale) })
    : t(locale, "tg.chart_caption", { name: goldName(locale) });
}

/** Failure receipt for the mechanical /chart command. */
export function telegramChartFailed(locale: AppLocale): string {
  return t(locale, "tg.chart_failed");
}
