"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const updatePopoverPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPopoverPos({ top: rect.bottom + 4, left: rect.left });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!mobile) updatePopoverPos();
    const onReposition = () => {
      if (!mobile) updatePopoverPos();
    };
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, mobile, updatePopoverPos]);

  useEffect(() => {
    if (!open || mobile) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        panelRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
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
          : "min-w-[10rem] rounded-xl border border-border bg-card p-2 shadow-xl",
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

  const desktopPanel =
    open &&
    !mobile &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={panelRef}
        className="pointer-events-auto fixed z-[60]"
        style={{ top: popoverPos.top, left: popoverPos.left }}
      >
        {list}
      </div>,
      document.body,
    );

  const mobilePanel =
    open &&
    mobile &&
    typeof document !== "undefined" &&
    createPortal(
      <>
        <button
          type="button"
          className="pointer-events-auto fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
          aria-label="إغلاق"
          onClick={() => setOpen(false)}
        />
        <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-[70] flex max-h-[50dvh] flex-col rounded-t-2xl border-t border-border bg-card shadow-xl">
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
      </>,
      document.body,
    );

  return (
    <div className="relative pointer-events-auto">
      <button
        ref={triggerRef}
        type="button"
        className={cn(CTRL, "px-2")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (!open && !mobile) updatePopoverPos();
          setOpen((o) => !o);
        }}
      >
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span dir="ltr">{value}</span>
      </button>

      {desktopPanel}
      {mobilePanel}
    </div>
  );
}
