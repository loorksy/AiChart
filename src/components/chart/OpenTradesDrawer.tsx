"use client";

import { X } from "lucide-react";
import { ActiveTradesTable } from "@/components/bridge/ActiveTradesTable";
import { cn } from "@/lib/utils";

export function OpenTradesDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        aria-label="إغلاق"
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed inset-y-0 z-50 flex w-[min(100%,420px)] flex-col border-border bg-card shadow-xl",
          "end-0 border-s",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">الصفقات المفتوحة</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <ActiveTradesTable />
        </div>
      </aside>
    </>
  );
}
