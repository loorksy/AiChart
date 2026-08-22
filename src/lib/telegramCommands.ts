/**
 * The Telegram menu vocabulary, read from `telegram-ar-commands.json`.
 *
 * The JSON is language DATA: slash commands, their Arabic descriptions, and
 * the Arabic agent-action each menu entry expands to. This module only
 * resolves against it — no user-facing text is authored here.
 *
 * The execution-era surface (approval buttons, open-position controls, the
 * callback→command map) was deleted with the execution layer: the platform
 * issues recommendations and never executes trades, and nothing imported
 * those builders anymore.
 */
import arMenu from "./telegram-ar-commands.json";

export interface BotCommandDef {
  command: string;
  description: string;
}

const MENU_ACTIONS = arMenu.menuActions as Record<string, string>;

/** The agent-action string the /chart command expands to (menu JSON, single source). */
export const CHART_ACTION = MENU_ACTIONS.chart;

/** The marker string the /model command resolves to (menu JSON, single source). */
export const MODEL_ACTION = MENU_ACTIONS.model;

/** The marker the /hisab (account status) command resolves to. */
export const ACCOUNT_ACTION = MENU_ACTIONS.hisab;

/** Telegram setMyCommands entries (Latin command + Arabic description). */
export function arabicBotCommands(): BotCommandDef[] {
  return arMenu.botCommands as BotCommandDef[];
}

export function slashCommandToAgentAction(slash: string): string | null {
  const key = slash.replace(/^\//, "").toLowerCase();
  return MENU_ACTIONS[key] ?? null;
}

export function replyLabelToAgentCommand(label: string): string | null {
  const trimmed = label.trim();
  return MENU_ACTIONS[trimmed] ?? null;
}

export function resolveUserMenuInput(text: string): string | null {
  const t = text.trim();
  if (t.startsWith("/")) return slashCommandToAgentAction(t);
  return replyLabelToAgentCommand(t);
}
