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
 */
import { DISPLAY_NAME_AR } from "@/lib/gold";
import { t } from "@/lib/i18n";
import { CHART_ACTION, MODEL_ACTION, resolveUserMenuInput } from "@/lib/telegramCommands";

export type TelegramCommand =
  | { kind: "chart_photo" }
  | { kind: "model_menu" }
  | { kind: "prompt"; message: string };

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
  if (mapped) return { kind: "prompt", message: mapped };
  return null;
}

/** The /start deep-link response — an auth mechanism's receipt, not a reply. */
export function telegramLinkedWelcome(): string {
  return t("ar", "tg.linked_welcome", { name: DISPLAY_NAME_AR });
}

/** Caption for the mechanical /chart command's photo. */
export function telegramChartCaption(closed: boolean): string {
  return closed
    ? t("ar", "tg.chart_caption_closed", { name: DISPLAY_NAME_AR })
    : t("ar", "tg.chart_caption", { name: DISPLAY_NAME_AR });
}

/** Failure receipt for the mechanical /chart command. */
export function telegramChartFailed(): string {
  return t("ar", "tg.chart_failed");
}
