/**
 * Conversation memory lifecycle: summarize every 6 messages, index into semantic
 * memory, and soft-archive redundant summaries. LLM + embedding heavy, so it
 * runs as a background `memory_lifecycle` job (or inline when no queue), never
 * on the chat request's critical path.
 */
import { loadChatMessages, setConversationSummary } from "./conversations";
import { createLogger } from "./logger";

const log = createLogger("memory");

export async function runMemoryLifecycle(
  userId: number,
  conversationId: number,
): Promise<void> {
  const messages = await loadChatMessages(conversationId);
  if (messages.length < 6) return;
  const messagesCount = messages.length;
  if (messagesCount % 6 !== 0) return;

  const { callLLM } = await import("./llm");
  const system =
    "أنت مساعد متخصص في تلخيص محادثات التداول المالي. لخص هذه المحادثة الجارية بين المستخدم والمساعد الذكي في 2-4 جمل واضحة ومكثفة باللغة العربية، تركز على أهداف المستخدم، الصفقات التي تمت مناقشتها، المخاطر، والتفضيلات المحددة. لا تذكر عبارات مثل 'في هذه المحادثة'.";

  const chatHistoryText = messages
    .map((m) => `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content}`)
    .join("\n");

  const res = await callLLM({
    system,
    messages: [{ role: "user", content: chatHistoryText }],
    maxTokens: 500,
  });

  const summaryText = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();

  if (!summaryText) return;

  await setConversationSummary(conversationId, summaryText);

  const { insertSemanticMemory, searchSemanticMemories, archiveSemanticMemory } =
    await import("./semanticMemory");

  await insertSemanticMemory({
    userId,
    category: "conversation_summary",
    content: `ملخص محادثة (معرف: ${conversationId}): ${summaryText}`,
    conversationId,
  });

  if (messagesCount === 12 || messagesCount === 24) {
    await insertSemanticMemory({
      userId,
      category: "conversation_full",
      content:
        `نص المحادثة الكاملة (معرف: ${conversationId}):\n` +
        chatHistoryText.slice(0, 4000),
      conversationId,
    });
  }

  const existing = await searchSemanticMemories(
    userId,
    summaryText,
    "conversation_summary",
    50,
    0.1,
  ).catch(() => []);

  if (existing.length > 15) {
    const sorted = [...existing].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    for (const mem of sorted.slice(0, sorted.length - 15)) {
      await archiveSemanticMemory(mem.id, userId).catch(() => {});
    }
  }
  log.debug("memory lifecycle complete", { userId, conversationId, messagesCount });
}
