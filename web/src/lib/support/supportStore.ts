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
}

export interface MessageRow {
  id: number;
  ticket_id: number;
  author: "user" | "bot" | "admin";
  author_id: number | null;
  body: string;
  created_at: number;
}

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
): Promise<void> {
  await execute(
    "INSERT INTO support_messages (ticket_id, author, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
    [ticketId, author, authorId, body, Date.now()],
  );
  await execute("UPDATE support_tickets SET updated_at = ? WHERE id = ?", [
    Date.now(),
    ticketId,
  ]);
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
            `أنت مساعد الدعم الفني لمنصة AiChart. أجب فقط من التوثيق التالي، بالعربية، بإيجاز وودّية. ` +
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
