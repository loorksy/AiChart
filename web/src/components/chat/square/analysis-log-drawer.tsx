"use client";

import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import { X } from "lucide-react";
import type { ChartAnalysisLogEntry } from "@/lib/conversations";
import { cn } from "@/lib/utils";

export function AnalysisLogDrawer({
  open,
  onClose,
  analyses,
  loading,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  analyses: ChartAnalysisLogEntry[];
  loading?: boolean;
  onSelect: (entry: ChartAnalysisLogEntry) => void;
}) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
        aria-label="إغلاق"
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed inset-y-0 z-50 flex w-[min(100%,320px)] flex-col border-border bg-card shadow-xl",
          "end-0 border-s md:absolute md:end-auto md:start-0 md:z-30 md:h-full md:w-72 md:border-e md:border-s-0 md:shadow-none",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-3">
          <span className="text-sm font-semibold">سجل التحليلات</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              جاري التحميل…
            </p>
          ) : analyses.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              لا تحليلات محفوظة في هذه المحادثة.
            </p>
          ) : (
            analyses.map((a) => (
              <button
                key={a.messageId}
                type="button"
                onClick={() => onSelect(a)}
                className="mb-1 w-full rounded-lg border border-transparent px-3 py-2.5 text-start transition hover:border-border hover:bg-secondary/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold" dir="ltr">
                    {a.symbol} · {a.interval}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(a.created_at), {
                      addSuffix: true,
                      locale: ar,
                    })}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                  {a.excerpt || "—"}
                </p>
              </button>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
