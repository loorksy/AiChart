"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, Inbox, MessageSquare } from "lucide-react";

import { Badge } from "@/components/squareui/badge";
import { Button } from "@/components/squareui/button";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";
import { cn } from "@/lib/utils";
import {
  AdminCard,
  AdminCardBody,
  AdminCardFooter,
  AdminCardHeader,
  AdminPage,
  EmptyState,
  Field,
  InlineAlert,
  SectionHeader,
  Spinner,
} from "@/components/admin/ui/AdminKit";

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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  open: "default",
  in_progress: "secondary",
  closed: "outline",
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
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

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
    setError(null);
    try {
      const res = await fetch("/api/admin/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "reply"
            ? { action, ticket_id: active.id, body: reply }
            : { action, ticket_id: active.id },
        ),
      });
      if (!res.ok) {
        setError(
          action === "reply"
            ? "لم يُرسل الرد — نصّك ما زال في الصندوق، أعد المحاولة."
            : "تعذّر تنفيذ الإجراء على التذكرة — أعد المحاولة.",
        );
        return;
      }
      if (action === "reply") {
        setReply("");
        setTouched(false);
      }
      if (action === "close") {
        setActive(null);
        setThread(null);
      } else {
        await openThread(active);
      }
      await load();
    } catch {
      setError("تعذّر الوصول إلى الخادم — لم يُنفَّذ أي إجراء.");
    } finally {
      setBusy(false);
    }
  }

  if (tickets === null) {
    return (
      <AdminPage dir="rtl">
        <CardSkeleton lines={6} />
      </AdminPage>
    );
  }

  const waiting = tickets.filter((t) => t.needs_human === 1).length;
  const replyError =
    touched && reply.trim().length === 0 ? "اكتب نص الرد قبل الإرسال." : undefined;

  return (
    <AdminPage dir="rtl" data-testid="admin-support-panel">
      <SectionHeader
        title="الدعم"
        description="تذاكر العملاء — المُصعَّدة إلى مشرف تظهر أولاً."
        icon={MessageSquare}
        actions={
          waiting > 0 ? (
            <Badge variant="destructive">{waiting} بانتظار مشرف</Badge>
          ) : (
            <Badge variant="secondary">لا تذاكر مُصعَّدة</Badge>
          )
        }
      />

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {active == null ? (
        <AdminCard>
          <AdminCardHeader
            title="صندوق التذاكر"
            description={`${tickets.length} تذكرة`}
          />
          {tickets.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="لا تذاكر مفتوحة"
              description="كل العملاء مخدومون — ستظهر أي تذكرة جديدة هنا فور وصولها."
            />
          ) : (
            <ul>
              {tickets.map((t, i) => (
                <li
                  key={t.id}
                  style={{ "--motion-index": i } as CSSProperties}
                  className="motion-fade-in motion-stagger border-b border-border/60 last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => void openThread(t)}
                    className="focus-ring-inset tap-target flex w-full items-center justify-between gap-3 px-4 py-3 text-start text-sm transition-colors duration-150 ease-out hover:bg-muted/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{t.subject}</span>
                      <span className="text-[11px] text-muted-foreground">
                        عميل #{t.user_id} · {new Date(t.updated_at).toLocaleString("ar")}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {t.needs_human === 1 && (
                        <Badge variant="destructive">بانتظار مشرف</Badge>
                      )}
                      <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>
                        {STATUS_AR[t.status] ?? t.status}
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      ) : (
        <AdminCard>
          <AdminCardHeader
            title={active.subject}
            description={`عميل #${active.user_id} · ${STATUS_AR[active.status] ?? active.status}`}
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="tap-target"
                  onClick={() => {
                    setActive(null);
                    setThread(null);
                    setError(null);
                    void load();
                  }}
                >
                  {/* Mirrors with the document direction: in RTL "back" points
                      toward the inline start, which is the right edge. */}
                  <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
                  الصندوق
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="tap-target"
                  onClick={() => act("assign")}
                  disabled={busy}
                >
                  إسناد لي
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="tap-target"
                  onClick={() => act("close")}
                  disabled={busy}
                >
                  إغلاق التذكرة
                </Button>
              </>
            }
          />

          <AdminCardBody className="max-h-[50vh] space-y-3 overflow-y-auto">
            {(thread ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                لا رسائل في هذه التذكرة بعد.
              </p>
            ) : (
              (thread ?? []).map((m, i) => (
                <div
                  key={m.id}
                  style={{ "--motion-index": i } as CSSProperties}
                  className={cn(
                    "motion-fade-in motion-stagger rounded-xl border px-4 py-3 text-sm leading-relaxed",
                    m.author === "admin"
                      ? "border-primary/30 bg-primary/5"
                      : "border-border bg-muted/30",
                  )}
                >
                  <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
                    {AUTHOR_AR[m.author]} · {new Date(m.created_at).toLocaleString("ar")}
                  </p>
                  <p className="whitespace-pre-wrap text-foreground">{m.body}</p>
                </div>
              ))
            )}
          </AdminCardBody>

          <AdminCardFooter className="block">
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                setTouched(true);
                if (reply.trim()) void act("reply");
              }}
            >
              <Field
                label="ردّك للعميل"
                htmlFor="support-reply"
                error={replyError}
                className="flex-1"
              >
                <textarea
                  id="support-reply"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onBlur={() => setTouched(true)}
                  placeholder="اكتب ردك للعميل…"
                  rows={2}
                  aria-invalid={replyError ? true : undefined}
                  aria-describedby={replyError ? "support-reply-error" : undefined}
                  className="admin-input focus-ring w-full resize-y text-sm"
                />
              </Field>
              <Button
                type="submit"
                className="tap-target h-10 shrink-0"
                disabled={busy || !reply.trim()}
              >
                {busy ? <Spinner /> : null}
                إرسال الرد
              </Button>
            </form>
          </AdminCardFooter>
        </AdminCard>
      )}
    </AdminPage>
  );
}
