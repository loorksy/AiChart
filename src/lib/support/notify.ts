import { queryOne } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { resolveUserLocale } from "@/lib/i18n/userLocale";
import { t } from "@/lib/i18n";
import { getPublicAppUrl } from "@/lib/appUrl";

const log = createLogger("support.notify");

/**
 * Tell the other side that something was said.
 *
 * A conversation where a reply can sit unseen for a day is a ticket queue
 * wearing a chat interface. Both sides are told, by the means each actually
 * watches:
 *
 *   - the USER, on Telegram when they have linked it, since that is a device
 *     in their pocket rather than a tab they may not have open. The in-app
 *     unread badge covers them either way.
 *   - the ADMIN, through the console's unread count, which is where they work.
 *
 * Best-effort by contract: a notification that fails must never cost the
 * message that triggered it. The message is already stored before this runs.
 */
export async function notifySupportReply(userId: number): Promise<void> {
  try {
    const row = await queryOne<{ telegram_id: string | null }>(
      "SELECT telegram_id FROM users WHERE id = ?",
      [userId],
    );
    const chatId = row?.telegram_id?.trim();
    if (!chatId) return;

    const locale = await resolveUserLocale(userId);
    // Dynamic import: the Telegram client pulls in the bot layer, and the
    // support store is reached from routes that have no business loading it.
    const { sendMessage } = await import("@/lib/telegram");
    await sendMessage(
      chatId,
      `${t(locale, "support.notify.reply")}\n${getPublicAppUrl()}/support`,
    );
  } catch (error) {
    log.warn("support reply notification failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
