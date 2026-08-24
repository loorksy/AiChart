"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LifeBuoy, Paperclip, Send, X } from "lucide-react";

import { PageHeader } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import { notifySupportRead } from "@/hooks/useSupportUnread";
import { cn } from "@/lib/utils";

/**
 * Support, as a conversation the user actually has.
 *
 * What was here before was a queue: a form that filed a ticket and a list to
 * check on it. This is the other thing — one thread, opened where it was left,
 * with history, files and replies arriving in it. The shape is deliberately the
 * one everybody already knows from a messaging app, because that is the shape
 * people already know how to use.
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
  const bottom = useRef<HTMLDivElement | null>(null);
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
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

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

  const time = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title={t("support.title")}
        description={t("support.subtitle")}
        icon={<LifeBuoy className="h-5 w-5" />}
      />

      <div
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4"
        data-testid="support-thread"
        aria-live="polite"
      >
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("support.empty")}
          </p>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => {
              const mine = m.author === "user";
              return (
                <li
                  key={m.id}
                  className={cn("flex", mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm sm:max-w-[70%]",
                      mine
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    <p className="mb-1 text-[11px] opacity-70">
                      {mine
                        ? t("support.you")
                        : m.author === "bot"
                          ? t("support.bot")
                          : t("support.team")}
                      {" · "}
                      <span dir="ltr">{time.format(new Date(m.created_at))}</span>
                    </p>
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
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
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottom} />
      </div>

      {status === "closed" && (
        <p className="text-xs text-muted-foreground" role="status">
          {t("support.closed")}
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert" data-testid="support-error">
          {error}
        </p>
      )}

      {file && (
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
          <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{file.name}</span>
          <span className="shrink-0 text-muted-foreground" dir="ltr">
            {formatBytes(file.size)}
          </span>
          <button
            type="button"
            className="ms-auto shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t("support.attach_remove")}
            onClick={() => {
              setFile(null);
              if (fileInput.current) fileInput.current.value = "";
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!sending) void send();
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          data-testid="support-file"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("support.attach")}
          title={t("support.attach")}
          onClick={() => fileInput.current?.click()}
          disabled={sending}
        >
          <Paperclip className="h-4 w-4" aria-hidden />
        </Button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={1}
          dir={dir}
          maxLength={4000}
          placeholder={t("support.placeholder")}
          data-testid="support-input"
          className="max-h-32 min-h-9 flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line — the messaging-app rule.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!sending) void send();
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          aria-label={t("support.send")}
          title={t("support.send")}
          disabled={sending}
          data-testid="support-send"
        >
          <Send className="h-4 w-4" aria-hidden />
        </Button>
      </form>
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
