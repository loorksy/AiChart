"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/hooks/useLocale";
import { useComposerChrome } from "@/components/agent/ComposerChrome";
import { cn } from "@/lib/utils";

/** How much of the sheet stays tucked under the writing field (matches --composer-sheet-tuck). */
const TUCK = 40;

/**
 * One sheet for model, timeframe and risk.
 *
 * It rises from behind the writing field and stays partly tucked under it —
 * a layered 3D sit, not a floating menu and not a bottom sheet. Chrome
 * matches the model chip: rounded, blurred, no title bar.
 */
export function ComposerPopover({
  open,
  onClose,
  anchorRef,
  title,
  children,
  labelledBy,
  testId = "composer-popover",
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  title: string;
  children: ReactNode;
  labelledBy?: string;
  testId?: string;
}) {
  const { dir } = useLocale();
  const chrome = useComposerChrome();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const host = chrome?.hostRef.current;
      const root = chrome?.rootRef.current;
      const panel = panelRef.current;
      if (!host || !root || !panel) return;
      const hostRect = host.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const gutter = 12;
      const width = Math.max(200, hostRect.width - gutter * 2);
      const available = Math.max(hostRect.top - gutter, 160);
      const height = Math.min(panel.offsetHeight || 200, available + TUCK);
      setPos({
        top: hostRect.top - rootRect.top - height + TUCK,
        left: hostRect.left - rootRect.left + gutter,
        width,
        maxHeight: available + TUCK,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    if (panelRef.current) observer?.observe(panelRef.current);
    if (chrome?.hostRef.current) observer?.observe(chrome.hostRef.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();
    };
  }, [open, chrome]);

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

  const root = chrome?.rootRef.current;
  if (!mounted || !open || !root) return null;

  return createPortal(
    <div
      ref={panelRef}
      dir={dir}
      role="dialog"
      aria-label={labelledBy ? undefined : title}
      aria-labelledby={labelledBy}
      data-testid={testId}
      style={
        pos
          ? {
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }
          : undefined
      }
      className={cn(
        "composer-sheet absolute overflow-hidden",
        !pos && "-top-[999px] start-0",
      )}
    >
      <div className="composer-menu-scroll min-h-0 max-h-[min(50vh,20rem)] p-1 pb-0">
        {children}
      </div>
    </div>,
    root,
  );
}
