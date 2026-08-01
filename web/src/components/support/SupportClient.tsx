"use client";

import { useCallback, useEffect, useState } from "react";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";

interface Ticket {
  id: number;
  subject: string;
  status: string;
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
  user: "أنت",
  bot: "المساعد الذكي",
  admin: "فريق الدعم",
};

/** V2-C (#97): the user's support surface. */
export function SupportClient() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [thread, setThread] = useState<Message[] | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const loadTickets = useCallback(async () => {
    const res = await fetch("/api/support/tickets");
    if (res.ok) setTickets(((await res.json()) as { tickets: Ticket[] }).tickets);
  }, []);

  const loadThread = useCallback(async (id: number) => {
    const res = await fetch(`/api/support/tickets/${id}`);
    if (res.ok) {
      setThread(((await res.json()) as { messages: Message[] }).messages);
      setActive(id);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  // The bot answers asynchronously — poll the open thread briefly.
  useEffect(() => {
    if (active == null) return;
    const t = setInterval(() => void loadThread(active), 5000);
    return () => clearInterval(t);
  }, [active, loadThread]);

  async function openTicket() {
    setBusy(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const data = (await res.json()) as { ok: boolean; ticket_id?: number };
      if (data.ok && data.ticket_id) {
        setSubject("");
        setBody("");
        await loadTickets();
        await loadThread(data.ticket_id);
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (active == null || !reply.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/support/tickets/${active}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      await loadThread(active);
    } finally {
      setBusy(false);
    }
  }

  if (tickets === null) return <CardSkeleton lines={5} />;

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">الدعم الفني</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          مساعد ذكي يجيب فوراً من التوثيق — واكتب «أريد مشرفاً» في أي وقت لتصعيد
          تذكرتك لفريق الدعم.
        </p>
      </div>

      {active == null ? (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">تذكرة جديدة</h2>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="الموضوع"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="صف مشكلتك أو سؤالك…"
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
            />
            <button
              onClick={openTicket}
              disabled={busy || subject.length < 3 || body.length < 5}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? "جارٍ الفتح…" : "فتح التذكرة"}
            </button>
          </section>

          <section className="rounded-xl border border-border bg-card">
            <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">تذاكري</h2>
            {tickets.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                لا تذاكر بعد.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => void loadThread(t.id)}
                      className="flex w-full items-center justify-between px-5 py-3 text-right text-sm hover:bg-muted/40"
                    >
                      <span className="text-foreground">{t.subject}</span>
                      <span className="text-xs text-muted-foreground">
                        {STATUS_AR[t.status] ?? t.status}
                        {t.needs_human === 1 && " · بانتظار مشرف"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <button
            onClick={() => {
              setActive(null);
              setThread(null);
              void loadTickets();
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← العودة للتذاكر
          </button>
          <div className="space-y-3">
            {(thread ?? []).map((m) => (
              <div
                key={m.id}
                className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${
                  m.author === "user"
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
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void sendReply()}
              placeholder="اكتب ردك… (أو «أريد مشرفاً» للتصعيد)"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
            />
            <button
              onClick={sendReply}
              disabled={busy || !reply.trim()}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              إرسال
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
