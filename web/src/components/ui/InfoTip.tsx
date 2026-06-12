"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function InfoTip({
  children,
  label = "مزيد من المعلومات",
  className,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const sheetId = useId();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open || mobile) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
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

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={sheetId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground",
          className,
        )}
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {open && !mobile && (
        <div
          ref={popRef}
          role="tooltip"
          className="absolute start-0 top-full z-50 mt-1 max-w-xs rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg"
        >
          {children}
        </div>
      )}

      {open && mobile && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="إغلاق"
            onClick={() => setOpen(false)}
          />
          <div
            id={sheetId}
            role="dialog"
            aria-modal="true"
            className="relative max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover p-4 text-sm"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">{label}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="text-muted-foreground">{children}</div>
          </div>
        </div>
      )}
    </span>
  );
}

/** Label + optional InfoTip in one row */
export function LabelWithTip({
  label,
  tip,
  htmlFor,
}: {
  label: string;
  tip?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <span className="relative inline-flex items-center gap-1.5 text-sm font-medium">
      {htmlFor ? (
        <label htmlFor={htmlFor}>{label}</label>
      ) : (
        <span>{label}</span>
      )}
      {tip && <InfoTip>{tip}</InfoTip>}
    </span>
  );
}
