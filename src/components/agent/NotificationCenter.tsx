"use client";

/**
 * Notification bell + center over /api/alerts (Group 9).
 *
 * The initial list comes from GET /api/alerts; everything after that arrives
 * over the SSE stream at /api/alerts/stream. The stream client reconnects with
 * exponential backoff and resumes from the last received id, and a client-side
 * id map dedupes as a backup — a reconnect replaying an alert must never show
 * it twice. Read state is server-truth via PATCH /api/alerts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Bell, CheckCheck, Settings2, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { AlertLog } from "@/lib/types";

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const MAX_ALERTS = 100;

type PanelPos = { top: number; left: number; width: number; maxHeight: number };

function typeTone(type: AlertLog["type"]): string {
  switch (type) {
    case "trade_executed":
      return "bg-buy";
    case "trade_closed":
      return "bg-info";
    case "trade_failed":
      return "bg-destructive";
    default:
      return "bg-warning";
  }
}

export function NotificationCenter({ className }: { className?: string }) {
  const { t, dir } = useLocale();
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const lastIdRef = useRef(0);
  const mounted = useRef(true);

  /** Insert with id-dedupe (the backup for a replaying stream). */
  const merge = useCallback((incoming: AlertLog[]) => {
    if (!incoming.length) return;
    setAlerts((prev) => {
      const byId = new Map<number, AlertLog>(prev.map((a) => [a.id, a]));
      for (const alert of incoming) byId.set(alert.id, alert);
      return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, MAX_ALERTS);
    });
    for (const alert of incoming) {
      if (alert.id > lastIdRef.current) lastIdRef.current = alert.id;
    }
  }, []);

  const connect = useCallback(() => {
    if (!mounted.current) return;
    sourceRef.current?.close();
    const url =
      lastIdRef.current > 0
        ? `/api/alerts/stream?lastId=${lastIdRef.current}`
        : "/api/alerts/stream";
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      attemptRef.current = 0;
      if (mounted.current) setConnected(true);
    };
    source.addEventListener("alert", (event) => {
      try {
        const alert = JSON.parse((event as MessageEvent).data) as AlertLog;
        merge([alert]);
      } catch {
        /* malformed event — ignored */
      }
    });
    source.onerror = () => {
      // Manual reconnect with backoff instead of EventSource's fixed retry,
      // resuming from the last id we actually processed.
      source.close();
      if (!mounted.current) return;
      setConnected(false);
      const attempt = attemptRef.current++;
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => {
        if (mounted.current) setReconnectAttempt((value) => value + 1);
      }, delay);
    };
  }, [merge]);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/alerts", { cache: "no-store" });
        if (!res.ok) throw new Error("load failed");
        const json = (await res.json()) as { alerts?: AlertLog[] };
        merge(json.alerts ?? []);
        setError(false);
      } catch {
        if (mounted.current) setError(true);
      }
      connect();
    })();
    return () => {
      mounted.current = false;
      sourceRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect, merge, reconnectAttempt]);

  const unread = alerts.filter((a) => a.read_at == null).length;

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 320;
      const gutter = 8;
      let left = dir === "rtl" ? rect.right - width : rect.left;
      left = Math.max(gutter, Math.min(left, window.innerWidth - width - gutter));
      const top = Math.min(rect.bottom + 6, window.innerHeight - 120);
      setPos({
        top,
        left,
        width,
        maxHeight: Math.max(200, window.innerHeight - top - 16),
      });
    }
    setOpen(true);
  };

  const markAllRead = async () => {
    setAlerts((prev) =>
      prev.map((a) => (a.read_at == null ? { ...a, read_at: new Date().toISOString() } : a)),
    );
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    }).catch(() => undefined);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={t("alerts.open")}
        aria-expanded={open}
        data-testid="notification-bell"
        className={cn(
          "relative flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-ring tap-target-expand",
          className,
        )}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unread > 0 ? (
          <span
            data-testid="notification-unread-badge"
            className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[80]" dir={dir}>
              <button
                type="button"
                aria-label={t("shell.close")}
                className="absolute inset-0 cursor-default"
                onClick={() => setOpen(false)}
              />
              <div
                role="dialog"
                aria-label={t("alerts.title")}
                data-testid="notification-center"
                className="absolute flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border elevation-4"
                style={{
                  top: pos?.top ?? 56,
                  left: pos?.left ?? 16,
                  width: pos?.width ?? 320,
                  maxHeight: pos?.maxHeight ?? 420,
                  backgroundColor: "var(--background)",
                }}
              >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <p className="text-sm font-semibold text-foreground">{t("alerts.title")}</p>
                  <div className="flex items-center gap-1">
                    {unread > 0 ? (
                      <button
                        type="button"
                        onClick={() => void markAllRead()}
                        className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-ring sm:min-h-8"
                      >
                        <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                        {t("alerts.mark_all")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      aria-label={t("shell.close")}
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-ring tap-target-expand"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </div>

                {!connected ? (
                  <p className="shrink-0 border-b border-border bg-warning/10 px-3 py-1 text-[11px] text-warning">
                    {t("alerts.reconnecting")}
                  </p>
                ) : null}
                {error ? (
                  <p className="shrink-0 border-b border-border bg-destructive/10 px-3 py-1 text-[11px] text-destructive">
                    {t("alerts.error")}
                  </p>
                ) : null}

                <div className="aichart-scroll min-h-0 flex-1 overflow-y-auto">
                  {alerts.length === 0 ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                      {t("alerts.empty")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {alerts.map((alert) => (
                        <li
                          key={alert.id}
                          className={cn(
                            "flex items-start gap-2.5 px-3 py-2.5",
                            alert.read_at == null && "bg-muted/40",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              alert.read_at == null ? typeTone(alert.type) : "bg-border",
                            )}
                          />
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium text-foreground">
                              {alert.title}
                            </p>
                            {alert.body ? (
                              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                                {alert.body}
                              </p>
                            ) : null}
                            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                              {alert.symbol ? `${alert.symbol} · ` : ""}
                              {alert.created_at}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Alert preferences (alerts_enabled / alert_signals) live in
                    settings — link there rather than duplicating the form. */}
                <Link
                  href="/console/settings"
                  onClick={() => setOpen(false)}
                  className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Settings2 className="h-3.5 w-3.5" aria-hidden />
                  {t("alerts.prefs")}
                </Link>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
