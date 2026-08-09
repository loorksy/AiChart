"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, LifeBuoy, RotateCw, Send, Inbox } from "lucide-react";

import { EmptyState, PageHeader, SectionHeader, Surface } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";
import { cn } from "@/lib/utils";

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
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const loadTickets = useCallback(async () => {
    setLoadFailed(false);
    setError(null);
    try {
      const res = await fetch("/api/support/tickets");
      if (res.ok) {
        setTickets(((await res.json()) as { tickets: Ticket[] }).tickets);
      } else {
        setError("تعذّر تحميل التذاكر.");
        setLoadFailed(true);
      }
    } catch {
      setError("تعذّر الاتصال بالخادم.");
      setLoadFailed(true);
    }
  }, []);

  const loadThread = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/support/tickets/${id}`);
      if (res.ok) {
        setThread(((await res.json()) as { messages: Message[] }).messages);
        setActive(id);
      } else {
        setError("تعذّر تحميل المحادثة.");
      }
    } catch {
      setError("تعذّر الاتصال بالخادم.");
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

  // A reply that lands below the fold reads as "nothing happened".
  useEffect(() => {
    if (!thread?.length) return;
    threadEndRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
    });
  }, [thread]);

  async function openTicket() {
    setBusy(true);
    setError(null);
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
      } else {
        setError("تعذّر فتح التذكرة. حاول مرة أخرى.");
      }
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (active == null || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/support/tickets/${active}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      await loadThread(active);
    } catch {
      setError("تعذّر إرسال الرد.");
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <PageHeader
      title="الدعم الفني"
      description="مساعد ذكي يجيب فوراً من التوثيق — واكتب «أريد مشرفاً» في أي وقت لتصعيد تذكرتك لفريق الدعم."
      icon={<LifeBuoy aria-hidden="true" />}
    />
  );

  const errorBanner = error ? (
    <Surface role="alert" padding="sm" className="border-destructive/30 bg-destructive/10">
      <p className="type-caption text-destructive">{error}</p>
    </Surface>
  ) : null;

  // Previously a failed first load left the skeleton on screen forever.
  if (tickets === null) {
    return (
      <div className="space-y-6">
        {header}
        {loadFailed ? (
          <Surface padding="none">
            <EmptyState
              announce
              tone="danger"
              icon={<AlertTriangle aria-hidden="true" />}
              title="تعذّر تحميل التذاكر"
              description={error ?? "حدث خطأ غير متوقع."}
              action={
                <Button size="xl" onClick={() => void loadTickets()}>
                  <RotateCw aria-hidden="true" />
                  إعادة المحاولة
                </Button>
              }
            />
          </Surface>
        ) : (
          <div aria-busy="true" aria-live="polite">
            <span className="sr-only">جارٍ تحميل التذاكر…</span>
            <CardSkeleton lines={5} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {errorBanner}

      {active == null ? (
        <>
          {/* Ticket list first — the returning user's context — then the form. */}
          <Surface as="section" padding="none">
            <SectionHeader title="تذاكري" className="border-b border-border px-5 py-3" />
            {tickets.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Inbox aria-hidden="true" />}
                title="لا تذاكر بعد"
                description="افتح تذكرة من النموذج بالأسفل وسيصلك رد فوري."
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => void loadThread(t.id)}
                      className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 py-3 text-start text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <span className="min-w-0 flex-1 text-foreground">{t.subject}</span>
                      <span className="type-caption shrink-0">
                        {STATUS_AR[t.status] ?? t.status}
                        {t.needs_human === 1 && " · بانتظار مشرف"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Surface>

          <Surface as="section" padding="lg" className="space-y-3">
            <SectionHeader
              title="تذكرة جديدة"
              description="اشرح المشكلة بأكبر قدر من التفاصيل — يجيبك المساعد فوراً."
            />
            <div className="space-y-1.5">
              <label htmlFor="support-subject" className="type-caption block font-medium">
                الموضوع
              </label>
              <input
                id="support-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="مثال: لا يظهر حسابي بعد الربط"
                className="min-h-11 w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="support-body" className="type-caption block font-medium">
                التفاصيل
              </label>
              <textarea
                id="support-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="صف مشكلتك أو سؤالك…"
                rows={4}
                className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button
              size="xl"
              className="w-full sm:w-auto"
              onClick={openTicket}
              disabled={busy || subject.length < 3 || body.length < 5}
            >
              {busy ? "جارٍ الفتح…" : "فتح التذكرة"}
            </Button>
          </Surface>
        </>
      ) : (
        <Surface as="section" padding="lg" className="space-y-4">
          <Button
            variant="ghost"
            size="xl"
            className="-ms-2"
            onClick={() => {
              setActive(null);
              setThread(null);
              void loadTickets();
            }}
          >
            {/* Mirrors under RTL so "back" still points the way the reader came from. */}
            <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
            العودة للتذاكر
          </Button>

          <div className="space-y-3" aria-live="polite" aria-label="محادثة التذكرة">
            {(thread ?? []).map((m) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-[var(--radius-lg)] border px-4 py-3 text-sm leading-relaxed",
                  m.author === "user"
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-muted/30",
                )}
              >
                <p className="type-caption mb-1 font-semibold">
                  {AUTHOR_AR[m.author]} ·{" "}
                  {/* Number() first: an Invalid Date makes toISOString THROW,
                      and a thrown render is how "open ticket" became a dead
                      page when the driver delivered this timestamp as a string. */}
                  <time dateTime={new Date(Number(m.created_at)).toISOString()}>
                    {new Date(m.created_at).toLocaleString("ar")}
                  </time>
                </p>
                <p className="whitespace-pre-wrap text-foreground">{m.body}</p>
              </div>
            ))}
            <div ref={threadEndRef} />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="support-reply" className="sr-only">
              ردك على التذكرة
            </label>
            <input
              id="support-reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void sendReply()}
              placeholder="اكتب ردك… (أو «أريد مشرفاً» للتصعيد)"
              className="min-h-11 flex-1 rounded-[var(--radius)] border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              size="xl"
              onClick={sendReply}
              disabled={busy || !reply.trim()}
            >
              <Send aria-hidden="true" className="rtl:rotate-180" />
              إرسال
            </Button>
          </div>
        </Surface>
      )}
    </div>
  );
}
