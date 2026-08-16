/**
 * OpenClaw Telegram conversation window, scaled to Lonora.
 *
 * Mapped from extensions/telegram (OpenClaw) — Telegram-only, not the rest
 * of that repo:
 *
 *   AGENTS.md                     one visible preview; edit it forward
 *   draft-stream.ts               send + editMessageText; delete leftover previews
 *   bot-message-dispatch-draft.ts live lane that becomes the final answer
 *   bot-message-dispatch-progress.ts  "Thinking…" then collapse in place
 *   progress-draft-preview.ts     status lines on that same bubble
 *   send-actions.ts               sendChatAction + deleteMessage
 *   send-edit.ts                  finalize / strip buttons
 *   reply-parameters.ts           reply_to_message_id
 *   button-types.ts               buttons only from presentation / ask_user
 *   question-finalization         tap → edit, drop keyboard, mark chosen
 *
 * Lonora does not stream tokens. This is the same window contract: one
 * status bubble (أوقظ → أفكّر) that becomes the answer, or is deleted when
 * the real payload is a photo. Buttons are not this module's job — the
 * agent attaches them only when it authored a question or a report link.
 */
import {
  deleteMessage,
  editMessageText,
  sendChatAction,
  sendMessage,
  type InlineButton,
} from "@/lib/telegram";

export const LIVE_WAKE_TEXT = "⌛ أوقظ الوكيل…";
export const LIVE_THINK_TEXT = "⌛ أفكّر…";

export class TelegramLiveTurn {
  private messageId: number | null = null;

  constructor(
    private readonly chatId: string,
    private readonly replyToMessageId?: number,
  ) {}

  async show(text: string): Promise<void> {
    await sendChatAction(this.chatId).catch(() => {});
    if (this.messageId == null) {
      this.messageId = await sendMessage(this.chatId, text, undefined, {
        replyToMessageId: this.replyToMessageId,
      });
      return;
    }
    await editMessageText(this.chatId, this.messageId, text, {
      parseMode: "HTML",
    }).catch(() => {});
  }

  async wake(): Promise<void> {
    await this.show(LIVE_WAKE_TEXT);
  }

  async think(): Promise<void> {
    await this.show(LIVE_THINK_TEXT);
  }

  async finalize(text: string, buttons?: InlineButton[][]): Promise<void> {
    if (this.messageId == null) {
      await sendMessage(this.chatId, text, buttons, {
        replyToMessageId: this.replyToMessageId,
      });
      return;
    }
    try {
      await editMessageText(this.chatId, this.messageId, text, {
        parseMode: "HTML",
        buttons: buttons ?? [],
      });
    } catch {
      await sendMessage(this.chatId, text, buttons, {
        replyToMessageId: this.replyToMessageId,
      });
    }
  }

  /** OpenClaw preview cleanup: the status bubble goes away when a photo replaces it. */
  async discard(): Promise<void> {
    if (this.messageId == null) return;
    const id = this.messageId;
    this.messageId = null;
    await deleteMessage(this.chatId, id).catch(() => {});
  }
}
