import type { Message } from "./anthropic";
import {
  buildUserMessageContent,
  parseImageFromMetadata,
} from "./chatImage";
import { getDb } from "./db";
import type { ChatMessageRow, Conversation } from "./types";

const MAX_MESSAGES_LOAD = 40;

const TELEGRAM_TITLE = "📱 تليجرام";

export function getOrCreateTelegramConversation(userId: number): Conversation {
  const existing = getDb()
    .prepare(
      `SELECT * FROM conversations WHERE user_id = ? AND title = ? LIMIT 1`,
    )
    .get(userId, TELEGRAM_TITLE) as Conversation | undefined;
  if (existing) return existing;
  return createConversation(userId, TELEGRAM_TITLE);
}

export function createConversation(userId: number, title = "محادثة جديدة"): Conversation {
  const info = getDb()
    .prepare(
      `INSERT INTO conversations (user_id, title) VALUES (?, ?)`,
    )
    .run(userId, title);
  return getConversation(Number(info.lastInsertRowid), userId)!;
}

export function getConversation(
  id: number,
  userId: number,
): Conversation | null {
  return (
    (getDb()
      .prepare(
        "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
      )
      .get(id, userId) as Conversation | undefined) ?? null
  );
}

export function listConversations(userId: number, limit = 50): Conversation[] {
  return getDb()
    .prepare(
      `SELECT * FROM conversations
       WHERE user_id = ? AND archived = 0
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(userId, limit) as Conversation[];
}

export function listArchivedConversations(
  userId: number,
  limit = 30,
): Conversation[] {
  return getDb()
    .prepare(
      `SELECT * FROM conversations
       WHERE user_id = ? AND archived = 1
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(userId, limit) as Conversation[];
}

export function archiveConversation(id: number, userId: number): boolean {
  const r = getDb()
    .prepare(
      `UPDATE conversations SET archived = 1, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .run(id, userId);
  return r.changes > 0;
}

export function unarchiveConversation(id: number, userId: number): boolean {
  const r = getDb()
    .prepare(
      `UPDATE conversations SET archived = 0, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .run(id, userId);
  return r.changes > 0;
}

export function deleteConversation(id: number, userId: number): boolean {
  const r = getDb()
    .prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return r.changes > 0;
}

export function updateConversationTitle(
  id: number,
  userId: number,
  title: string,
): void {
  getDb()
    .prepare(
      `UPDATE conversations SET title = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .run(title.slice(0, 120), id, userId);
}

export function autoTitleFromMessage(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 48) return clean || "محادثة جديدة";
  return `${clean.slice(0, 45)}…`;
}

export function appendChatMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
  metadata?: Record<string, unknown>,
): ChatMessageRow {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO chat_messages (conversation_id, role, content, metadata_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      conversationId,
      role,
      content,
      metadata ? JSON.stringify(metadata) : null,
    );
  db.prepare(
    `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`,
  ).run(conversationId);
  return db
    .prepare("SELECT * FROM chat_messages WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as ChatMessageRow;
}

export function loadChatMessages(
  conversationId: number,
  limit = MAX_MESSAGES_LOAD,
): ChatMessageRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM chat_messages
       WHERE conversation_id = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(conversationId, limit) as ChatMessageRow[];
  return rows.reverse();
}

export function countChatMessages(conversationId: number): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ?",
    )
    .get(conversationId) as { n: number };
  return row.n;
}

export function getConversationSummary(conversationId: number): string | null {
  const row = getDb()
    .prepare("SELECT summary FROM conversations WHERE id = ?")
    .get(conversationId) as { summary: string | null } | undefined;
  return row?.summary ?? null;
}

export function setConversationSummary(
  conversationId: number,
  summary: string,
): void {
  getDb()
    .prepare("UPDATE conversations SET summary = ? WHERE id = ?")
    .run(summary.slice(0, 500), conversationId);
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
