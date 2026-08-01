"use client";

import { useCallback, useEffect, useState } from "react";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";

interface Ticket {
  id: number;
  user_id: number;
  subject: string;
  status: string;
  assigned_to: number | null;
  needs_human: number;
  updated_at: number;
}

interface Message {
  id: number;
  author: "user" | "bot" | "admin";
  body: string;
  created_at: number;
}

const STATUS_AR: Record<string, string> = {
  open: "مفتوحة",
  in_progress: "قيد المتابعة",
  closed: "مغلقة",
};

const AUTHOR_AR: Record<string, string> = {
  user: "العميل",
  bot: "المساعد الذكي",
  admin: "فريق الدعم",
};

/**
 * V2-C follow-up: the support INBOX — where admins answer customers.
 * Tickets flagged «بانتظار مشرف» float first; replying auto-assigns the
 * ticket to you and moves it to in_progress. Runs on the `tickets`
 * permission, so a support-role admin sees exactly this and nothing else.
 */
export function AdminSupportPanel() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [active, setActive] = useState<Ticket | null>(null);
  const [thread, setThread] = useState<Message[] | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/support");
    if (res.ok) {
      const data = (await res.json()) as { tickets: Ticket[] };
      // Human-escalated first, then most recently active.
      setTickets(
        [...data.tickets].sort(
          (a, b) => b.needs_human - a.needs_human || b.updated_at - a.updated_at,
        ),
      );
    }
  }, []);

  const openThread = useCallback(async (ticket: Ticket) => {
    const res = await fetch(`/api/admin/support?ticket=${ticket.id}`);
    if (res.ok) {
      const data = (await res.json()) as { ticket: Ticket; messages: Message[] };
      setActive(data.ticket);
      setThread(data.messages);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: "reply" | "close" | "assign") {
    if (!active) return;
    setBusy(true);
    try {
      await fetch("/api/admin/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "reply"
            ? { action, ticket_id: active.id, body: reply }
            : { action, ticket_id: active.id },
        ),
      });
      if (action === "reply") setReply("");
      if (action === "close") {
        setActive(null);
        setThread(null);
      } else {
        await openThread(active);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (tickets === null) return <CardSkeleton lines={5} />;

  return (
    <div className="space-y-4" dir="rtl">
      {active == null ? (
        <section className="rounded-xl border border-border bg-card">
          <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
            صندوق التذاكر ({tickets.length})
          </h3>
          {tickets.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              لا تذاكر — كل العملاء سعداء 🎉
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => void openThread(t)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right text-sm hover:bg-muted/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{t.subject}</span>
                      <span className="text-[11px] text-muted-foreground">
                        عميل #{t.user_id} · {new Date(t.updated_at).toLocaleString("ar")}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs">
                      {t.needs_human === 1 && (
                        <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-500">
                          بانتظار مشرف
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {STATUS_AR[t.status] ?? t.status}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setActive(null);
                setThread(null);
                void load();
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← الصندوق
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => act("assign")}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                إسناد لي
              </button>
              <button
                onClick={() => act("close")}
                disabled={busy}
                className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              >
                إغلاق التذكرة
              </button>
            </div>
          </div>
          <h3 className="text-sm font-semibold text-foreground">{active.subject}</h3>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            {(thread ?? []).map((m) => (
              <div
                key={m.id}
                className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${
                  m.author === "admin"
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-muted/30"
                }`}
              >
                <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
                  {AUTHOR_AR[m.author]} · {new Date(m.created_at).toLocaleString("ar")}
                </p>
                <p className="whitespace-pre-wrap text-foreground">{m.body}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="اكتب ردك للعميل…"
              rows={2}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
            />
            <button
              onClick={() => act("reply")}
              disabled={busy || !reply.trim()}
              className="self-end rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              إرسال الرد
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
