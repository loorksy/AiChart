import type { Message } from "./anthropic";
import {
  buildUserMessageContent,
  parseImageFromMetadata,
} from "./chatImage";
import { execute, insertReturningId, query, queryOne } from "./db";
import type { ChatMessageRow, Conversation } from "./types";

const MAX_MESSAGES_LOAD = 80;

const TELEGRAM_TITLE = "📱 تليجرام";

export async function getOrCreateTelegramConversation(
  userId: number,
): Promise<Conversation> {
  const existing = await queryOne<Conversation>(
    `SELECT * FROM conversations WHERE user_id = ? AND title = ? LIMIT 1`,
    [userId, TELEGRAM_TITLE],
  );
  if (existing) return existing;
  return createConversation(userId, TELEGRAM_TITLE);
}

export async function createConversation(
  userId: number,
  title = "محادثة جديدة",
): Promise<Conversation> {
  const id = await insertReturningId(
    `INSERT INTO conversations (user_id, title) VALUES (?, ?)`,
    [userId, title],
  );
  return (await getConversation(id, userId))!;
}

export async function getConversation(
  id: number,
  userId: number,
): Promise<Conversation | null> {
  return queryOne<Conversation>(
    "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
    [id, userId],
  );
}

export async function listConversations(
  userId: number,
  limit = 50,
): Promise<Conversation[]> {
  return query<Conversation>(
    `SELECT * FROM conversations
     WHERE user_id = ? AND archived = 0
     ORDER BY updated_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export async function listArchivedConversations(
  userId: number,
  limit = 30,
): Promise<Conversation[]> {
  return query<Conversation>(
    `SELECT * FROM conversations
     WHERE user_id = ? AND archived = 1
     ORDER BY updated_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export async function archiveConversation(
  id: number,
  userId: number,
): Promise<boolean> {
  const result = await execute(
    `UPDATE conversations SET archived = 1, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return result.changes > 0;
}

export async function unarchiveConversation(
  id: number,
  userId: number,
): Promise<boolean> {
  const result = await execute(
    `UPDATE conversations SET archived = 0, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return result.changes > 0;
}

export async function deleteConversation(
  id: number,
  userId: number,
): Promise<boolean> {
  const result = await execute(
    "DELETE FROM conversations WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return result.changes > 0;
}

export async function updateConversationTitle(
  id: number,
  userId: number,
  title: string,
): Promise<void> {
  await execute(
    `UPDATE conversations SET title = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    [title.slice(0, 120), id, userId],
  );
}

export function autoTitleFromMessage(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 48) return clean || "محادثة جديدة";
  return `${clean.slice(0, 45)}…`;
}

export async function appendChatMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
  metadata?: Record<string, unknown>,
  reasoningSummary?: string | null,
  toolCallsJson?: string | null,
): Promise<ChatMessageRow> {
  const id = await insertReturningId(
    `INSERT INTO chat_messages (conversation_id, role, content, metadata_json, reasoning_summary, tool_calls_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      conversationId,
      role,
      content,
      metadata ? JSON.stringify(metadata) : null,
      reasoningSummary ?? null,
      toolCallsJson ?? null,
    ],
  );
  await execute(
    `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`,
    [conversationId],
  );
  return (await queryOne<ChatMessageRow>(
    "SELECT * FROM chat_messages WHERE id = ?",
    [id],
  ))!;
}

export async function loadChatMessages(
  conversationId: number,
  limit = MAX_MESSAGES_LOAD,
): Promise<ChatMessageRow[]> {
  const rows = await query<ChatMessageRow>(
    `SELECT * FROM chat_messages
     WHERE conversation_id = ?
     ORDER BY id DESC LIMIT ?`,
    [conversationId, limit],
  );
  return rows.reverse();
}

export async function countChatMessages(conversationId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ?",
    [conversationId],
  );
  return row?.n ?? 0;
}

export async function getConversationSummary(
  conversationId: number,
): Promise<string | null> {
  const row = await queryOne<{ summary: string | null }>(
    "SELECT summary FROM conversations WHERE id = ?",
    [conversationId],
  );
  return row?.summary ?? null;
}

export async function setConversationSummary(
  conversationId: number,
  summary: string,
): Promise<void> {
  await execute("UPDATE conversations SET summary = ? WHERE id = ?", [
    summary.slice(0, 500),
    conversationId,
  ]);
}

/** Build Anthropic history from persisted messages (includes chart images). */
export function messagesToAgentHistory(rows: ChatMessageRow[]): Message[] {
  return rows.map((r) => {
    if (r.role === "assistant") {
      return { role: "assistant", content: r.content };
    }
    const image = parseImageFromMetadata(r.metadata_json);
    return {
      role: "user",
      content: buildUserMessageContent(r.content, image),
    };
  });
}
