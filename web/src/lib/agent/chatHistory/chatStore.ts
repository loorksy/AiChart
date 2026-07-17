/**
 * Persistent chat history store. Backs the sidebar chat sessions and reload
 * survival. Backend-agnostic: uses the unified db layer (SQLite/Postgres) with
 * `?` placeholders (adaptSql rewrites them for Postgres). All reads/writes are
 * scoped by userId so one tenant can never touch another's chats.
 */
import { execute, query, queryOne } from "@/lib/db";
import {
  DEFAULT_CHAT_TITLE_AR,
  defaultChatTitle,
  isDefaultChatTitle,
} from "./composeChatMeta";
import type {
  AgentChatLanguage,
  AgentChatMessageRecord,
  AgentChatSession,
  AppendAgentChatMessageInput,
} from "./types";

/** @deprecated Prefer defaultChatTitle(language) — kept for legacy callers/tests. */
const DEFAULT_TITLE = DEFAULT_CHAT_TITLE_AR;
const MAX_TITLE_LEN = 48;
const PREVIEW_LEN = 120;

function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `chat-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

// Strictly-increasing timestamp so two appends in the same millisecond still
// order deterministically (created_at is the message sort key). A uuid PK gives
// no stable tiebreak, so the clock must not repeat within a process.
let lastTs = 0;
function monotonicNow(): number {
  const now = Date.now();
  lastTs = now > lastTs ? now : lastTs + 1;
  return lastTs;
}

/** Derive a chat title from the first meaningful user message. Pure + tested. */
export function deriveChatTitle(content: string): string {
  const firstLine =
    content
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const cleaned = firstLine.replace(/\s+/g, " ").trim();
  if (!cleaned) return DEFAULT_TITLE;
  if (cleaned.length <= MAX_TITLE_LEN) return cleaned;
  return `${cleaned.slice(0, MAX_TITLE_LEN - 1).trim()}…`;
}

function previewOf(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  return cleaned.length <= PREVIEW_LEN ? cleaned : `${cleaned.slice(0, PREVIEW_LEN - 1)}…`;
}

interface ChatRow {
  id: string;
  user_id: number;
  title: string;
  symbol: string | null;
  interval: string | null;
  language: string;
  created_at: number;
  updated_at: number;
  last_message_preview: string | null;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  result_json: string | null;
  recommendation_id: string | null;
  analysis_id: string | null;
  symbol: string | null;
  interval: string | null;
  created_at: number;
}

function toSession(row: ChatRow): AgentChatSession {
  return {
    id: row.id,
    userId: Number(row.user_id),
    title: row.title,
    symbol: row.symbol ?? undefined,
    interval: row.interval ?? undefined,
    language: (row.language === "en" ? "en" : "ar") as AgentChatLanguage,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastMessagePreview: row.last_message_preview ?? undefined,
  };
}

function toMessage(row: MessageRow): AgentChatMessageRecord {
  let result: unknown;
  if (row.result_json) {
    try {
      result = JSON.parse(row.result_json);
    } catch {
      result = undefined;
    }
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    createdAt: Number(row.created_at),
    result,
    recommendationId: row.recommendation_id ?? undefined,
    analysisId: row.analysis_id ?? undefined,
    symbol: row.symbol ?? undefined,
    interval: row.interval ?? undefined,
  };
}

export async function createChat(input: {
  userId: number;
  symbol?: string;
  interval?: string;
  language?: AgentChatLanguage;
  title?: string;
}): Promise<AgentChatSession> {
  const now = monotonicNow();
  const id = uuid();
  const language: AgentChatLanguage = input.language === "en" ? "en" : "ar";
  const title = input.title?.trim() || defaultChatTitle(language);
  await execute(
    `INSERT INTO agent_chats
       (id, user_id, title, symbol, interval, language, created_at, updated_at, last_message_preview)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      title,
      input.symbol ?? null,
      input.interval ?? null,
      language,
      now,
      now,
      null,
    ],
  );
  return {
    id,
    userId: input.userId,
    title,
    symbol: input.symbol,
    interval: input.interval,
    language,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listChats(
  userId: number,
  limit = 50,
): Promise<AgentChatSession[]> {
  const rows = await query<ChatRow>(
    `SELECT * FROM agent_chats
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT ?`,
    [userId, Math.max(1, Math.min(limit, 200))],
  );
  return rows.map(toSession);
}

export async function getChat(
  userId: number,
  chatId: string,
): Promise<AgentChatSession | null> {
  const row = await queryOne<ChatRow>(
    "SELECT * FROM agent_chats WHERE id = ? AND user_id = ?",
    [chatId, userId],
  );
  return row ? toSession(row) : null;
}

export async function getMessages(
  userId: number,
  chatId: string,
  limit = 500,
): Promise<AgentChatMessageRecord[]> {
  // Scope through the chat's owner so a message read can't cross tenants.
  const chat = await getChat(userId, chatId);
  if (!chat) return [];
  // Take the MOST RECENT window (a bounded read of a long conversation must
  // keep the latest turns — the old ascending LIMIT silently dropped them),
  // then restore chronological order for consumers.
  const rows = await query<MessageRow>(
    `SELECT * FROM agent_chat_messages
      WHERE chat_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [chatId, Math.max(1, Math.min(limit, 2000))],
  );
  return rows.map(toMessage).reverse();
}

/**
 * Append a message to a chat the user owns. Updates updatedAt and a temporary
 * preview. AI title/hook generation runs asynchronously after assistant turns
 * (see refreshChatMetaAfterAssistantTurn) — never from the raw first message.
 * Returns the stored record, or null if the chat does not belong to the user.
 */
export async function appendMessage(
  userId: number,
  chatId: string,
  input: AppendAgentChatMessageInput,
): Promise<AgentChatMessageRecord | null> {
  const chat = await getChat(userId, chatId);
  if (!chat) return null;

  const now = monotonicNow();
  const id = uuid();
  const resultJson =
    input.result === undefined ? null : safeStringify(input.result);
  await execute(
    `INSERT INTO agent_chat_messages
       (id, chat_id, user_id, role, content, result_json, recommendation_id, analysis_id, symbol, interval, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      chatId,
      userId,
      input.role,
      input.content,
      resultJson,
      input.recommendationId ?? null,
      input.analysisId ?? null,
      input.symbol ?? null,
      input.interval ?? null,
      now,
    ],
  );

  // Keep existing title; preview is a temporary line until AI hook lands.
  await execute(
    `UPDATE agent_chats
        SET updated_at = ?, last_message_preview = ?, symbol = COALESCE(?, symbol), interval = COALESCE(?, interval)
      WHERE id = ? AND user_id = ?`,
    [
      now,
      previewOf(input.content),
      input.symbol ?? null,
      input.interval ?? null,
      chatId,
      userId,
    ],
  );

  return {
    id,
    chatId,
    role: input.role,
    content: input.content,
    createdAt: now,
    result: input.result,
    recommendationId: input.recommendationId,
    analysisId: input.analysisId,
    symbol: input.symbol,
    interval: input.interval,
  };
}

/** Persist AI (or fallback) title + hook. Tenant-scoped. */
export async function updateChatMeta(
  userId: number,
  chatId: string,
  meta: { title: string; hook: string },
): Promise<AgentChatSession | null> {
  const chat = await getChat(userId, chatId);
  if (!chat) return null;
  const title = meta.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LEN) || chat.title;
  const hook = meta.hook.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LEN) || chat.lastMessagePreview || "";
  const now = monotonicNow();
  await execute(
    `UPDATE agent_chats
        SET title = ?, last_message_preview = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
    [title, hook || null, now, chatId, userId],
  );
  return getChat(userId, chatId);
}

export { isDefaultChatTitle };

export async function deleteChat(userId: number, chatId: string): Promise<boolean> {
  const chat = await getChat(userId, chatId);
  if (!chat) return false;
  await execute("DELETE FROM agent_chat_messages WHERE chat_id = ?", [chatId]);
  await execute("DELETE FROM agent_chats WHERE id = ? AND user_id = ?", [
    chatId,
    userId,
  ]);
  return true;
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
