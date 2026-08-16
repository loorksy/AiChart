"use client";

import { SidebarListSkeleton } from "@/components/ui/skeletons/page-skeletons";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";
import type { AlertLog } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALERT_TYPE_LABEL: Record<string, string> = {
  trade_executed: "تنفيذ صفقة",
  trade_closed: "إغلاق صفقة",
  trade_failed: "تعذّر التنفيذ",
  signal: "إشارة تداول",
};

export function NotificationPanel({
  unreadAlerts,
  onCountsChange,
}: {
  unreadAlerts: number;
  onCountsChange?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Pending approvals used to count toward this badge; there is nothing to
  // approve on a platform that places no orders.
  const badgeTotal = unreadAlerts;
  const showBell = badgeTotal > 0;

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) return;
      const data = await res.json();
      setAlerts(Array.isArray(data.alerts) ? data.alerts.slice(0, 15) : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const markRead = useCallback(async () => {
    try {
      await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      onCountsChange?.();
    } catch {
      /* ignore */
    }
  }, [onCountsChange]);

  useEffect(() => {
    if (!open) return;
    void loadAlerts();
    void markRead();
    const id = window.setInterval(() => {
      void loadAlerts();
      onCountsChange?.();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [open, loadAlerts, markRead, onCountsChange]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!showBell) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        aria-label={`${badgeTotal} إشعارات`}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
          {badgeTotal > 9 ? "9+" : badgeTotal}
        </span>
      </button>

      {open && (
        <div className="absolute end-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">التنبيهات</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-muted-foreground hover:bg-secondary"
              aria-label="إغلاق"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto p-2">

            <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              آخر التنبيهات
            </p>

            {loading && alerts.length === 0 ? (
              // The rows that are coming, not a sentence saying they are.
              <SidebarListSkeleton rows={4} />
            ) : alerts.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                لا توجد تنبيهات حديثة.
              </p>
            ) : (
              <ul className="space-y-1">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm",
                      a.read_at ? "opacity-80" : "bg-secondary/50",
                    )}
                  >
                    <p className="font-medium leading-snug">{a.title}</p>
                    {a.image_url && (
                      <img
                        src={a.image_url}
                        alt=""
                        className="mt-2 max-h-24 w-full rounded-md border border-border/50 object-cover"
                      />
                    )}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {ALERT_TYPE_LABEL[a.type] ?? a.type}
                      {a.symbol && (
                        <span dir="ltr"> · {a.symbol}</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border px-4 py-2">
            <Link
              href="/console/settings/alerts"
              onClick={() => setOpen(false)}
              className="text-link text-xs"
            >
              كل التنبيهات في الإعدادات ←
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
