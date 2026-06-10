import { execute, queryOne } from "./db";

export type TelegramPendingStep =
  | "awaiting_amount"
  | "awaiting_custom_amount"
  | "awaiting_rescan_confirm";

export interface TelegramPending {
  user_id: number;
  intent_id: number;
  step: TelegramPendingStep;
  message_id: number | null;
  updated_at: string;
}

export async function getTelegramPending(
  userId: number,
): Promise<TelegramPending | null> {
  return queryOne<TelegramPending>(
    "SELECT * FROM telegram_pending WHERE user_id = ?",
    [userId],
  );
}

export async function setTelegramPending(
  userId: number,
  intentId: number,
  step: TelegramPendingStep,
  messageId?: number | null,
): Promise<void> {
  await execute(
    `INSERT INTO telegram_pending (user_id, intent_id, step, message_id, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       intent_id = excluded.intent_id,
       step = excluded.step,
       message_id = excluded.message_id,
       updated_at = datetime('now')`,
    [userId, intentId, step, messageId ?? null],
  );
}

export async function clearTelegramPending(userId: number): Promise<void> {
  await execute("DELETE FROM telegram_pending WHERE user_id = ?", [userId]);
}
