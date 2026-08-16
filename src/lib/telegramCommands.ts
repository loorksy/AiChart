import type { InlineButton } from "./telegram";
import arMenu from "./telegram-ar-commands.json";

export interface BotCommandDef {
  command: string;
  description: string;
}

const MENU_ACTIONS = arMenu.menuActions as Record<string, string>;

/** Telegram setMyCommands entries (Latin command + Arabic description). */
export function arabicBotCommands(): BotCommandDef[] {
  return arMenu.botCommands as BotCommandDef[];
}

/** Reply keyboard rows shown below the chat input. */
export function arabicReplyKeyboardRows(): string[][] {
  return arMenu.replyKeyboard as string[][];
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

/** callback_data → command text for approval buttons. */
export const CMD_CALLBACK_MAP: Record<string, string> = {
  "cmd:home": MENU_ACTIONS.qaima,
  "cmd:balance": MENU_ACTIONS.status,
  "cmd:trades": MENU_ACTIONS.tawsia,
  "cmd:settings": MENU_ACTIONS.qaima,
  "cmd:market:forex": MENU_ACTIONS.tawsia,
  "cmd:env:demo": MENU_ACTIONS.qaima,
  "cmd:env:live": MENU_ACTIONS.qaima,
  "cmd:analyze:pick": MENU_ACTIONS.tawsia,
  "cmd:chart": MENU_ACTIONS.chart,
  "cmd:status": MENU_ACTIONS.status,
  "cmd:back": "رجوع",
  "cmd:next": "التالي",
};

export function agentCommandFromCallback(callback: string): string | null {
  if (CMD_CALLBACK_MAP[callback]) return CMD_CALLBACK_MAP[callback];
  const approve = /^cmd:approve:(\d+)$/.exec(callback);
  if (approve) {
    return `وافق على الصفقة المعلقة رقم ${approve[1]} — إن مرّ أكثر من دقيقة أعد تحليل السوق أولاً`;
  }
  const reject = /^cmd:reject:(\d+)$/.exec(callback);
  if (reject) return `ارفض الصفقة المعلقة رقم ${reject[1]}`;
  const review = /^cmd:review:(\d+)$/.exec(callback);
  if (review) return `راجع الصفقة المفتوحة رقم ${review[1]}`;
  const close = /^cmd:close:(\d+)$/.exec(callback);
  if (close) return `أغلق الصفقة رقم ${close[1]} بعد التحليل`;
  return null;
}

export function wrapAgentCommand(callback: string): string {
  const cmd = agentCommandFromCallback(callback);
  return cmd ? `[CMD:${callback}] ${cmd}` : `[CMD:${callback}]`;
}

export function mainMenuButtons(): InlineButton[][] {
  return [
    [
      { text: "توصية الذهب", callback_data: "cmd:analyze:pick" },
      { text: "صورة الشارت", callback_data: "cmd:chart" },
    ],
    [{ text: "حالة السوق", callback_data: "cmd:status" }],
  ];
}

export function postAnalysisButtons(intentId: number): InlineButton[][] {
  return [
    [
      { text: "✅ موافق", callback_data: `cmd:approve:${intentId}` },
      { text: "❌ رفض", callback_data: `cmd:reject:${intentId}` },
    ],
    [
      { text: "🔄 زوج آخر", callback_data: "cmd:analyze:pick" },
      { text: "📋 القائمة", callback_data: "cmd:home" },
    ],
  ];
}

export function buildApprovalButtons(intentId: number, practice = false): InlineButton[][] {
  const approveLabel = practice ? "✅ تجربة" : "✅ موافق";
  return [
    [
      { text: approveLabel, callback_data: `cmd:approve:${intentId}` },
      { text: "❌ رفض", callback_data: `cmd:reject:${intentId}` },
    ],
  ];
}

export function openPositionButtons(tradeId: number): InlineButton[][] {
  return [
    [
      { text: "🔍 مراجعة", callback_data: `cmd:review:${tradeId}` },
      { text: "🛑 إغلاق", callback_data: `cmd:close:${tradeId}` },
    ],
    [{ text: "📋 القائمة", callback_data: "cmd:home" }],
  ];
}

export function postTradeButtons(): InlineButton[][] {
  return [
    [
      { text: "▶️ كمّل؟", callback_data: "cmd:analyze:pick" },
      { text: "📈 الصفقات", callback_data: "cmd:trades" },
    ],
    [
      { text: "💰 الرصيد", callback_data: "cmd:balance" },
      { text: "📋 القائمة", callback_data: "cmd:home" },
    ],
  ];
}
