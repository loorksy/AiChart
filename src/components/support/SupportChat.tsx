"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Bot, LifeBuoy, Paperclip, X } from "lucide-react";

import { LiquidMetalFrame } from "@/components/ui/liquid-metal-button";
import { useLocale } from "@/hooks/useLocale";
import { notifySupportRead } from "@/hooks/useSupportUnread";
import { APP_WAKE_EVENT } from "@/lib/appWake";
import { formatClock, formatDayLabel, isSameCalendarDay } from "@/lib/display/timestamp";
import { cn } from "@/lib/utils";

/**
 * Support IS the agent chat surface — the same shell, the same scroll region,
 * the same docked composer on the same fade wall. No page header, no title
 * block: the thread starts where the agent thread starts, the operator's own
 * words sit in the same soft end-edge bubble, and the only differences are
 * the team badge + caption on replies and a quiet empty state.
 *
 * Timestamps go through `@/lib/display/timestamp` and ONLY through it. The
 * thread used to build its own "day/month + clock" format with numeric
 * fields; the Arabic pattern carries a bidi mark before the slash, so inside
 * this RTL page the pieces re-ordered, the day digits thrown to the far end.
 * The shared formatter spells the day as a word and isolates every fragment.
 */

interface SupportMessage {
  id: number;
  author: "user" | "bot" | "admin";
  body: string;
  created_at: number;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_bytes: number | null;
}

/** Mirrors the server's own list; the SERVER is what actually enforces it. */
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
const MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** How often the open conversation asks whether anything arrived. */
const POLL_MS = 15_000;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read_failed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // A data: URL — everything after the comma is the payload.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SupportChat() {
  const { t, locale, dir } = useLocale();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [status, setStatus] = useState<string>("open");
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  // Reading the thread is what clears the badge — but only the FIRST load
  // marks it read here; a poll that finds nothing new must not keep firing it.
  const announcedRead = useRef(false);

  const load = useCallback(() => {
    fetch("/api/support/conversation", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; messages?: SupportMessage[]; status?: string } | null) => {
        if (!data?.ok) throw new Error("load_failed");
        setMessages(data.messages ?? []);
        setStatus(data.status ?? "open");
        if (!announcedRead.current) {
          announcedRead.current = true;
          notifySupportRead();
        }
        setError(null);
      })
      .catch(() => setError(t("support.error.load")))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    // A backgrounded tab freezes the poll timer; on return, ask immediately
    // instead of waiting out the rest of the interval.
    const onWake = () => load();
    window.addEventListener(APP_WAKE_EVENT, onWake);
    return () => {
      clearInterval(timer);
      window.removeEventListener(APP_WAKE_EVENT, onWake);
    };
  }, [load]);

  // Scroll to the real bottom — past the composer-height padding — so the
  // newest message sits above the docked composer, never behind it.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Same live measurement as the agent panel: the scroll region's bottom
  // padding tracks the composer's actual height via --composer-height.
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const panel = panelRef.current;
    if (!dock || !panel) return;
    const apply = () => {
      panel.style.setProperty("--composer-height", `${dock.offsetHeight}px`);
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      panel.style.removeProperty("--composer-height");
    };
  }, []);

  function pick(chosen: File | null) {
    setError(null);
    if (!chosen) return;
    // A courtesy check so the person is told before a 5 MB upload; the server
    // repeats it from the bytes, and the server's answer is the one that counts.
    if (chosen.size > MAX_BYTES) {
      setError(t("support.error.too_large", { limit: formatBytes(MAX_BYTES) }));
      return;
    }
    setFile(chosen);
  }

  async function send() {
    const text = draft.trim();
    if (!text && !file) {
      setError(t("support.error.empty_message"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { body: text };
      if (file) {
        payload.attachment = { name: file.name, data_base64: await readAsBase64(file) };
      }
      const res = await fetch("/api/support/conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        messages?: SupportMessage[];
      } | null;
      if (!res.ok || !data?.ok) {
        // The server names WHY it refused; say that rather than "failed".
        const reason = data?.error;
        setError(
          reason === "too_large"
            ? t("support.error.too_large", { limit: formatBytes(MAX_BYTES) })
            : reason === "unsupported_type"
              ? t("support.error.unsupported_type")
              : reason === "empty_message"
                ? t("support.error.empty_message")
                : t("support.error.send"),
        );
        return;
      }
      setMessages(data.messages ?? []);
      setDraft("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setStatus("open");
    } catch {
      setError(t("support.error.send"));
    } finally {
      setSending(false);
    }
  }

  const canSend = (draft.trim().length > 0 || file != null) && !sending;
  const empty = !loading && messages.length === 0;

  return (
    <div ref={panelRef} className="chat-panel-shell h-full w-full bg-transparent" dir={dir}>
      <h1 className="sr-only">{t("support.title")}</h1>

      {/* The thread: the agent chat's scroll region, verbatim — one centred
          reading column, date separators carrying the day, each message then
          needing only its clock. */}
      <div
        ref={scrollerRef}
        data-testid="support-thread"
        aria-live="polite"
        className={
          empty
            ? "chat-scroll-region aichart-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-3"
            : "chat-scroll-region aichart-scroll min-h-0 flex-1 overflow-y-auto p-3"
        }
      >
        {loading ? (
          <div
            className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-1 pt-6"
            aria-busy="true"
          >
            <div className="ms-auto h-9 w-2/5 animate-pulse rounded-2xl bg-muted" />
            <div className="flex items-start gap-2.5">
              <div className="size-6 shrink-0 animate-pulse rounded-full bg-muted/70" />
              <div className="flex-1 space-y-2.5 pt-1">
                <div className="h-4 w-11/12 animate-pulse rounded bg-muted/70" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted/70" />
              </div>
            </div>
            <div className="ms-auto h-9 w-1/3 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : empty ? (
          /* Quiet empty state: a small badge and one line, centred in the
             space above the composer — no banner, no heading. */
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            <span
              aria-hidden
              className="flex size-10 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground"
            >
              <LifeBuoy className="size-4" />
            </span>
            <p className="max-w-[40ch] text-sm leading-6 text-muted-foreground">
              {t("support.empty")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col space-y-3">
            {messages.map((m, index) => {
              const mine = m.author === "user";
              const author = mine
                ? t("support.you")
                : m.author === "bot"
                  ? t("support.bot")
                  : t("support.team");
              const previous = messages[index - 1];
              const newDay =
                !previous || !isSameCalendarDay(previous.created_at, m.created_at);
              const separator = newDay ? (
                <div className="mx-auto flex w-full max-w-3xl items-center gap-3 py-1">
                  <span className="h-px flex-1 bg-border/60" aria-hidden />
                  <span className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {formatDayLabel(m.created_at, locale)}
                  </span>
                  <span className="h-px flex-1 bg-border/60" aria-hidden />
                </div>
              ) : null;
              return (
                <Fragment key={m.id}>
                  {separator}
                  {mine ? (
                    <div data-author={m.author} className="mx-auto w-full max-w-3xl">
                      <div className="ms-auto flex w-fit max-w-[min(85%,36rem)] flex-col items-end">
                        <div className="rounded-2xl bg-[var(--user-bubble)] px-3.5 py-2 text-sm leading-6 text-foreground">
                          {m.body && (
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          )}
                          {m.attachment_path && (
                            <SupportAttachment
                              path={m.attachment_path}
                              name={m.attachment_name}
                              bytes={m.attachment_bytes}
                              label={t("support.attachment")}
                              openLabel={t("support.attachment_open")}
                            />
                          )}
                        </div>
                        <span className="mt-1 text-[11px] leading-none tabular-nums text-muted-foreground">
                          {formatClock(m.created_at, locale)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div
                      data-author={m.author}
                      className="mx-auto w-full max-w-3xl px-1 py-2 text-[0.9375rem] leading-7 text-foreground"
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span
                          aria-hidden
                          className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-accent-gold/40 bg-accent-gold/10 text-accent-gold"
                        >
                          {m.author === "bot" ? (
                            <Bot className="size-3.5" />
                          ) : (
                            <LifeBuoy className="size-3.5" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="mb-0.5 flex items-baseline gap-2 text-[11px] leading-4">
                            <span className="font-semibold text-foreground/85">{author}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {formatClock(m.created_at, locale)}
                            </span>
                          </p>
                          {m.body && (
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          )}
                          {m.attachment_path && (
                            <SupportAttachment
                              path={m.attachment_path}
                              name={m.attachment_name}
                              bytes={m.attachment_bytes}
                              label={t("support.attachment")}
                              openLabel={t("support.attachment_open")}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* The agent chat's fade wall + docked composer, verbatim. */}
      <div className="chat-composer-fade" aria-hidden />
      <div ref={dockRef} className="chat-composer-dock">
        {status === "closed" && (
          <p
            className="mx-auto w-full max-w-3xl px-4 pb-1 text-xs text-muted-foreground"
            role="status"
          >
            {t("support.closed")}
          </p>
        )}

        {error && (
          <p
            className="mx-auto w-full max-w-3xl px-4 pb-1 text-xs text-destructive"
            role="alert"
            data-testid="support-error"
          >
            {error}
          </p>
        )}

        <form
          className="chat-composer-shell relative overflow-visible px-3 pt-1 pb-[max(.5rem,env(safe-area-inset-bottom))]"
          dir={dir}
          onSubmit={(e) => {
            e.preventDefault();
            if (!sending) void send();
          }}
        >
          <LiquidMetalFrame className="chat-gpt-input mx-auto w-full max-w-3xl">
            <div className="flex flex-col px-4 pb-4 pt-5">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter breaks the line. isComposing guards
                  // the Arabic/predictive IME, where Enter commits a candidate.
                  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (!sending) void send();
                }}
                rows={1}
                dir={dir}
                maxLength={4000}
                placeholder={t("support.placeholder")}
                aria-label={t("support.placeholder")}
                data-testid="support-input"
                disabled={sending}
                className="mb-4 max-h-[148px] min-h-4 w-full resize-none bg-transparent p-0 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />

              <div className="flex items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  data-testid="support-file"
                  onChange={(e) => pick(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  aria-label={t("support.attach")}
                  title={t("support.attach")}
                  onClick={() => fileInput.current?.click()}
                  disabled={sending}
                  className="metal-chip metal-chip-icon focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  <Paperclip className="size-4" aria-hidden />
                </button>

                {file && (
                  <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-foreground">
                    <span className="max-w-40 truncate">{file.name}</span>
                    <span className="shrink-0 text-muted-foreground" dir="ltr">
                      {formatBytes(file.size)}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={t("support.attach_remove")}
                      onClick={() => {
                        setFile(null);
                        if (fileInput.current) fileInput.current.value = "";
                      }}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </span>
                )}

                <div className="ms-auto flex items-center">
                  <button
                    type="submit"
                    aria-label={t("support.send")}
                    title={t("support.send")}
                    disabled={!canSend}
                    data-testid="support-send"
                    className={cn(
                      "metal-chip metal-chip-icon group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      canSend ? "composer-send-ready" : "opacity-40",
                    )}
                  >
                    <ArrowUp className="composer-send-glyph size-4" strokeWidth={2.25} aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          </LiquidMetalFrame>
        </form>
      </div>
    </div>
  );
}

/**
 * One file inside a bubble.
 *
 * Images are shown; anything else is a link that says what it is. The URL is
 * the private serving route, which checks that the reader is in this
 * conversation before it hands over a single byte.
 */
function SupportAttachment({
  path,
  name,
  bytes,
  label,
  openLabel,
}: {
  path: string;
  name: string | null;
  bytes: number | null;
  label: string;
  openLabel: string;
}) {
  const href = `/api/support/attachment/${encodeURIComponent(path)}`;
  const caption = name?.trim() || label;
  if (IMAGE_EXT.test(path)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={openLabel}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={href}
          alt={caption}
          className="mt-1 max-h-64 w-auto rounded-lg border border-border/40"
        />
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-flex items-center gap-1.5 text-xs underline underline-offset-4"
    >
      <Paperclip className="h-3 w-3" aria-hidden />
      <span className="truncate">{caption}</span>
      {bytes != null && (
        <span dir="ltr" className="opacity-70">
          {formatBytes(bytes)}
        </span>
      )}
    </a>
  );
}
