"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/**
 * The shared container for the composer's inline controls.
 *
 * On a phone these open upward from the bottom edge, like the chart sheet — but
 * deliberately not as the same thing: this one is compact, sized to its content,
 * and dims nothing behind it, because picking a model or nudging a risk figure
 * is an adjustment mid-sentence, not a change of surface. From `lg` it is an
 * ordinary popover anchored to the control that opened it.
 */
export function ComposerPopover({
  open,
  onClose,
  anchorRef,
  title,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  title: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  const { dir } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [compact, setCompact] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(
    null,
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Anchored placement, wide viewports only. Measured after open so the panel
  // has a size to sit above.
  useEffect(() => {
    if (!open || compact) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const rect = anchor.getBoundingClientRect();
      const width = panel.offsetWidth;
      const gutter = 8;
      const raw = dir === "rtl" ? rect.right - width : rect.left;
      // The panel sits ON the gap above the control, so its height is bounded
      // by that gap — a menu that loads its options late must scroll rather
      // than grow down across the control that opened it.
      const available = Math.max(rect.top - gutter * 2, 120);
      const height = Math.min(panel.offsetHeight, available);
      setPos({
        top: Math.max(gutter, rect.top - height - 8),
        left: Math.max(gutter, Math.min(raw, window.innerWidth - width - gutter)),
        maxHeight: available,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    // Sections that arrive after their fetch (models, execution mode) change
    // the panel's height after it was first measured; re-place when they do.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    if (panelRef.current) observer?.observe(panelRef.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();
    };
  }, [open, compact, dir, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const node = event.target as Node;
      if (panelRef.current?.contains(node)) return;
      if (anchorRef.current?.contains(node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      {/* Dismiss target only — transparent, because the conversation behind it
          should stay legible while a value is being adjusted. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-[150] cursor-default lg:hidden"
      />
      <div
        ref={panelRef}
        dir={dir}
        role="dialog"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        data-testid="composer-popover"
        style={
          pos
            ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight, overflowY: "auto" }
            : undefined
        }
        className={cn(
          "z-[151] overflow-hidden border border-border bg-background text-foreground shadow-2xl",
          compact
            ? [
                "fixed inset-x-2 bottom-2 rounded-[var(--radius-lg)]",
                "duration-250 animate-in slide-in-from-bottom-4 fade-in ease-out",
                "motion-reduce:animate-none",
              ]
            : [
                "fixed w-72 rounded-[var(--radius-lg)]",
                "duration-150 animate-in fade-in zoom-in-95 ease-out",
                "motion-reduce:animate-none",
                // Until measured, keep it off-screen rather than flashing at 0,0.
                !pos && "-top-[999px] start-0",
              ],
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <p className="text-xs font-semibold text-muted-foreground">{title}</p>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}
