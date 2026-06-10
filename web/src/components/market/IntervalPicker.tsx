"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Clock, X } from "lucide-react";
import { INTERVAL_GROUPS } from "@/lib/intervals";
import { cn } from "@/lib/utils";

const CTRL =
  "inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border/50 bg-background/80 text-xs font-medium text-foreground backdrop-blur-md transition hover:bg-background/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function IntervalPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (interval: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open || mobile) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, mobile]);

  useEffect(() => {
    if (!open || !mobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, mobile]);

  function pick(iv: string) {
    onChange(iv);
    setOpen(false);
  }

  const list = (
    <div
      id={listId}
      role="listbox"
      aria-label="الإطار الزمني"
      className={cn(
        mobile
          ? "max-h-[40dvh] overflow-y-auto px-3 pb-4"
          : "absolute start-0 top-full z-50 mt-1 min-w-[10rem] rounded-xl border border-border bg-card p-2 shadow-xl",
      )}
    >
      {INTERVAL_GROUPS.map((g) => (
        <div key={g.label} className={mobile ? "mb-3" : "mb-2 last:mb-0"}>
          <p className="mb-1 px-1 text-[10px] font-medium text-muted-foreground">
            {g.label}
          </p>
          <div className={cn("flex flex-wrap gap-1", mobile && "gap-1.5")}>
            {g.items.map((iv) => (
              <button
                key={iv}
                type="button"
                role="option"
                aria-selected={value === iv}
                onClick={() => pick(iv)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                  value === iv
                    ? "bg-foreground text-background"
                    : "bg-secondary/80 text-foreground hover:bg-secondary",
                  mobile && "min-h-[40px] min-w-[3rem]",
                )}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={cn(CTRL, "pointer-events-auto px-2")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span dir="ltr">{value}</span>
      </button>

      {open && !mobile && list}

      {open && mobile && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            aria-label="إغلاق"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[50dvh] flex-col rounded-t-2xl border-t border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <span className="text-sm font-semibold">الإطار الزمني</span>
              <button
                type="button"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"
                aria-label="إغلاق"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {list}
          </div>
        </>
      )}
    </div>
  );
}
