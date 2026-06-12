import { queryOne } from "./db";
import { logAudit } from "./store";
import { isTelegramConfigured, notifyUser } from "./telegram";

export type AgentWakeEvent =
  | "market_candidate"
  | "trade_alert"
  | "daily_loss_warn"
  | "daily_memory";

const EVENT_INSTRUCTIONS: Record<AgentWakeEvent, string> = {
  market_candidate:
    "راجع المرشح الفني أدناه. حلّل بعمق، سجّل توصية مع شارت إن وُجدت ثقة ≥75%، وتصرف حسب الوضع (auto/approval/direct). للفوركس: تحقق من diagnostics قبل التنفيذ.",
  trade_alert:
    "راجع تنبيه الصفقة أدناه. قارن بأطروحتك في الذاكرة — إن انكسرت الأطروحة أغلق أو عدّل حسب الوضع وأبلغ المشغّل.",
  daily_loss_warn:
    "اقتربت خسارة اليوم من الحد. أبلغ المشغّل بوضوح — لا تفتح صفقات جديدة إلا بموافقة صريحة.",
  daily_memory:
    "أُرسل الملخص اليومي للمشغّل. حدّث MEMORY.md بالدروس الدائمة ودوّن يوميات اليوم في memory/.",
};

export interface WakeAgentOptions {
  event: AgentWakeEvent;
  detail: string;
  /** Skip duplicate wakes of the same event within this many minutes. */
  dedupeMinutes?: number;
}

function wakeAuditAction(event: AgentWakeEvent): string {
  return `event_wake_${event}`;
}

export async function wasRecentlyWoken(
  userId: number,
  event: AgentWakeEvent,
  withinMinutes: number,
): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM audit_logs
     WHERE user_id = ? AND action = ?
       AND created_at > datetime('now', ? || ' minutes')`,
    [userId, wakeAuditAction(event), `-${withinMinutes}`],
  );
  return (row?.n ?? 0) > 0;
}

/** Sends a structured Telegram message so OpenClaw treats it as an event. */
export async function wakeAgentViaTelegram(
  userId: number,
  opts: WakeAgentOptions,
): Promise<boolean> {
  if (!isTelegramConfigured()) return false;

  const dedupe = opts.dedupeMinutes ?? 30;
  if (await wasRecentlyWoken(userId, opts.event, dedupe)) {
    return false;
  }

  const instruction = EVENT_INSTRUCTIONS[opts.event];
  const text = [
    `<b>[EVENT:${opts.event}]</b>`,
    instruction,
    "",
    opts.detail,
  ].join("\n");

  await notifyUser(userId, text);
  await logAudit(userId, wakeAuditAction(opts.event), opts.detail.slice(0, 500));
  return true;
}
