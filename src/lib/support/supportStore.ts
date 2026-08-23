import { execute, insertReturningId, query, queryOne } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("support");

/**
 * V2-C (#97): the ticket store + the docs-grounded instant bot.
 *
 * Every ticket gets an immediate AI answer built from the docs corpus,
 * billed to the ASKER's credits (withUsageContext kind=support_bot) —
 * consistent with "the platform owner never pays for a user's usage".
 * The bot never blocks ticket creation: if the model is down the ticket
 * still opens and a human follows up.
 */

export interface TicketRow {
  id: number;
  user_id: number;
  subject: string;
  status: string;
  assigned_to: number | null;
  needs_human: number;
  created_at: number;
  updated_at: number;
  /** When each side last opened the thread — the basis of "unread". */
  user_last_read_at: number | null;
  admin_last_read_at: number | null;
}

export interface MessageRow {
  id: number;
  ticket_id: number;
  author: "user" | "bot" | "admin";
  author_id: number | null;
  body: string;
  created_at: number;
  /** A file sent with this message; served through the support attachment route. */
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_bytes: number | null;
}

/** One side of the conversation, for read-state bookkeeping. */
export type ConversationSide = "user" | "admin";

export async function listUserTickets(userId: number): Promise<TicketRow[]> {
  return query<TicketRow>(
    "SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50",
    [userId],
  );
}

export async function listAllTickets(status?: string): Promise<TicketRow[]> {
  if (status) {
    return query<TicketRow>(
      "SELECT * FROM support_tickets WHERE status = ? ORDER BY updated_at DESC LIMIT 200",
      [status],
    );
  }
  return query<TicketRow>(
    "SELECT * FROM support_tickets ORDER BY updated_at DESC LIMIT 200",
  );
}

export async function getTicket(
  ticketId: number,
  userId?: number,
): Promise<{ ticket: TicketRow; messages: MessageRow[] } | null> {
  const ticket = await queryOne<TicketRow>(
    "SELECT * FROM support_tickets WHERE id = ?",
    [ticketId],
  );
  if (!ticket) return null;
  if (userId != null && ticket.user_id !== userId) return null;
  const messages = await query<MessageRow>(
    "SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at",
    [ticketId],
  );
  return { ticket, messages };
}

export async function addMessage(
  ticketId: number,
  author: "user" | "bot" | "admin",
  body: string,
  authorId: number | null,
  attachment?: { path: string; name: string; bytes: number } | null,
): Promise<void> {
  const now = Date.now();
  await execute(
    `INSERT INTO support_messages
       (ticket_id, author, author_id, body, created_at,
        attachment_path, attachment_name, attachment_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ticketId,
      author,
      authorId,
      body,
      now,
      attachment?.path ?? null,
      attachment?.name ?? null,
      attachment?.bytes ?? null,
    ],
  );
  // The sender has, by definition, read their own message: marking their side
  // read here is what keeps a reply from showing as unread to its own author.
  const senderColumn = author === "admin" ? "admin_last_read_at" : "user_last_read_at";
  await execute(
    `UPDATE support_tickets SET updated_at = ?, ${senderColumn} = ? WHERE id = ?`,
    [now, now, ticketId],
  );
}

/**
 * The user's ONE conversation with support.
 *
 * Support is a conversation, not a queue of tickets: a person opens the same
 * thread they were in last time and keeps talking. The open ticket IS that
 * thread; a new one is created only when there is none.
 */
export async function getOrCreateConversation(userId: number): Promise<number> {
  const open = await queryOne<{ id: number }>(
    "SELECT id FROM support_tickets WHERE user_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1",
    [userId],
  );
  if (open) return open.id;
  const now = Date.now();
  return insertReturningId(
    `INSERT INTO support_tickets (user_id, subject, created_at, updated_at, user_last_read_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, "support", now, now, now],
  );
}

/** Mark the thread read for one side, up to now. */
export async function markConversationRead(
  ticketId: number,
  side: ConversationSide,
): Promise<void> {
  const column = side === "admin" ? "admin_last_read_at" : "user_last_read_at";
  await execute(`UPDATE support_tickets SET ${column} = ? WHERE id = ?`, [
    Date.now(),
    ticketId,
  ]);
}

/**
 * How many messages the given side has not seen.
 *
 * Counted from the OTHER side's messages only: a thread is never unread
 * because of something you wrote yourself.
 */
export async function unreadCount(
  ticketId: number,
  side: ConversationSide,
): Promise<number> {
  const ticket = await queryOne<TicketRow>("SELECT * FROM support_tickets WHERE id = ?", [
    ticketId,
  ]);
  if (!ticket) return 0;
  const since = (side === "admin" ? ticket.admin_last_read_at : ticket.user_last_read_at) ?? 0;
  const authors = side === "admin" ? ["user"] : ["admin", "bot"];
  const placeholders = authors.map(() => "?").join(", ");
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM support_messages
      WHERE ticket_id = ? AND created_at > ? AND author IN (${placeholders})`,
    [ticketId, since, ...authors],
  );
  return Number(row?.count ?? 0);
}

/** Total unread messages waiting for this user, across their conversation. */
export async function userUnreadTotal(userId: number): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM support_messages m
       JOIN support_tickets t ON t.id = m.ticket_id
      WHERE t.user_id = ?
        AND m.author IN ('admin', 'bot')
        AND m.created_at > COALESCE(t.user_last_read_at, 0)`,
    [userId],
  );
  return Number(row?.count ?? 0);
}

/** Conversations with something the admin has not read yet. */
export async function adminUnreadTotal(): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(DISTINCT t.id) AS count
       FROM support_messages m
       JOIN support_tickets t ON t.id = m.ticket_id
      WHERE m.author = 'user'
        AND m.created_at > COALESCE(t.admin_last_read_at, 0)`,
  );
  return Number(row?.count ?? 0);
}

export async function createTicket(
  userId: number,
  subject: string,
  body: string,
): Promise<number> {
  const now = Date.now();
  const ticketId = await insertReturningId(
    "INSERT INTO support_tickets (user_id, subject, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [userId, subject, now, now],
  );
  await addMessage(ticketId, "user", body, userId);
  // Instant bot answer — fire-and-forget, never blocks ticket creation.
  void answerWithBot(ticketId, userId, subject, body).catch((e) =>
    log.warn("bot.failed", { ticketId, error: e instanceof Error ? e.message : String(e) }),
  );
  return ticketId;
}

async function answerWithBot(
  ticketId: number,
  userId: number,
  subject: string,
  body: string,
): Promise<void> {
  const { isLLMConfiguredAsync, callLLM } = await import("@/lib/llm");
  if (!(await isLLMConfiguredAsync())) return;
  const { withUsageContext } = await import("@/lib/billing/usageMeter");
  const { docsCorpus } = await import("@/lib/content/seedContent");
  const corpus = await docsCorpus();

  const res = await withUsageContext(
    { userId, kind: "support_bot", requestId: `ticket-${ticketId}` },
    () =>
      callLLM(
        {
          system:
            `أنت مساعد الدعم الفني لمنصة Lonora. أجب فقط من التوثيق التالي، بالعربية، بإيجاز وودّية. ` +
            `إن لم يغطِّ التوثيق السؤال قل ذلك صراحة واعرض التصعيد لمشرف بشري — لا تخترع إجابات.\n\n=== التوثيق ===\n${corpus}`,
          messages: [
            { role: "user", content: `الموضوع: ${subject}\n\n${body}` },
          ],
          maxTokens: 700,
        },
        { tier: "quick" },
      ),
  );
  const text = res.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (text) {
    await addMessage(
      ticketId,
      "bot",
      `${text}\n\n—\nهل أجاب هذا على سؤالك؟ إن لم يكن، اكتب «أريد مشرفاً» وسيتابع فريق الدعم تذكرتك.`,
      null,
    );
  }
}

export async function requestHuman(ticketId: number): Promise<void> {
  await execute(
    "UPDATE support_tickets SET needs_human = 1, updated_at = ? WHERE id = ?",
    [Date.now(), ticketId],
  );
}

export async function assignTicket(ticketId: number, adminId: number): Promise<void> {
  await execute(
    "UPDATE support_tickets SET assigned_to = ?, status = 'in_progress', updated_at = ? WHERE id = ?",
    [adminId, Date.now(), ticketId],
  );
}

export async function closeTicket(ticketId: number): Promise<void> {
  await execute(
    "UPDATE support_tickets SET status = 'closed', updated_at = ? WHERE id = ?",
    [Date.now(), ticketId],
  );
}
