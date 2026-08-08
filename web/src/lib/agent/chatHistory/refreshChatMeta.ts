/**
 * Async title/hook refresh after an assistant turn completes.
 * Fire-and-forget from the messages API — never delays the chat response.
 */
import {
  composeChatMeta,
  isDefaultChatTitle,
} from "./composeChatMeta";
import { getChat, getMessages, updateChatMeta } from "./chatStore";
import type { AgentChatAgentId } from "./types";

export async function refreshChatMetaAfterAssistantTurn(
  userId: number,
  chatId: string,
  agentId: AgentChatAgentId,
): Promise<void> {
  try {
    const chat = await getChat(userId, chatId, agentId);
    if (!chat) return;

    const messages = await getMessages(userId, chatId, agentId, 40);
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastAssistant || !lastUser) return;

    const meta = await composeChatMeta({
      language: chat.language,
      userText: lastUser.content,
      assistantText: lastAssistant.content,
      symbol: chat.symbol,
    });

    // Preserve non-default titles (AI-set or manually edited); always refresh hook.
    const nextTitle = isDefaultChatTitle(chat.title) ? meta.title : chat.title;
    await updateChatMeta(userId, chatId, agentId, {
      title: nextTitle,
      hook: meta.hook,
    });
  } catch {
    // Silent — title generation must never break chat.
  }
}
