"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CandlestickChart, GripVertical, MessageSquare, RotateCcw } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { MobilePane } from "@/lib/layout/chatLayout";
import {
  SWITCHER_DRAG_THRESHOLD_PX,
  SWITCHER_HEIGHT,
  SWITCHER_WIDTH,
  clampSwitcherY,
  defaultSwitcherPosition,
  loadSwitcherPosition,
  saveSwitcherPosition,
  snapSwitcherEdge,
  type SwitcherPosition,
} from "@/lib/layout/workspaceSwitcher";
import { cn } from "@/lib/utils";

/**
 * Compact movable edge switcher for Chart ↔ Chat on narrow viewports.
 * Defaults: RTL → left edge, LTR → right edge. Drag to reposition; snaps to edges.
 */
export function FloatingWorkspaceSwitcher({
  pane,
  onChange,
}: {
  pane: MobilePane;
  onChange: (pane: MobilePane) => void;
}) {
  const { t, dir } = useLocale();
  const labelId = useId();
  const [pos, setPos] = useState<SwitcherPosition>(() =>
    defaultSwitcherPosition(dir === "rtl" ? "rtl" : "ltr"),
  );
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originY: number;
    dragging: boolean;
  } | null>(null);

  useEffect(() => {
    const vh = window.innerHeight;
    setPos(loadSwitcherPosition(dir === "rtl" ? "rtl" : "ltr", vh));
  }, [dir]);

  const applyPos = useCallback((next: SwitcherPosition) => {
    const vh = window.innerHeight;
    const clamped = { edge: next.edge, y: clampSwitcherY(next.y, vh) };
    setPos(clamped);
    saveSwitcherPosition(clamped, vh);
  }, []);

  const reset = () => {
    applyPos(defaultSwitcherPosition(dir === "rtl" ? "rtl" : "ltr", window.innerHeight));
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originY: pos.y,
      dragging: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.dragging && Math.hypot(dx, dy) < SWITCHER_DRAG_THRESHOLD_PX) return;
    drag.dragging = true;
    setPos((prev) => ({
      ...prev,
      y: clampSwitcherY(drag.originY + dy, window.innerHeight),
    }));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    if (!drag.dragging) return;
    applyPos({
      edge: snapSwitcherEdge(event.clientX, window.innerWidth),
      y: clampSwitcherY(drag.originY + (event.clientY - drag.startY), window.innerHeight),
    });
  };

  const nudge = (deltaY: number) => {
    applyPos({ ...pos, y: pos.y + deltaY });
  };

  const style: React.CSSProperties = {
    position: "fixed",
    top: pos.y,
    [pos.edge]: 8,
    width: SWITCHER_WIDTH,
    minHeight: SWITCHER_HEIGHT,
    zIndex: 35,
  };

  return (
    <div
      data-testid="chart-chat-switcher"
      data-edge={pos.edge}
      role="toolbar"
      aria-labelledby={labelId}
      className="xl:hidden"
      style={style}
    >
      <span id={labelId} className="sr-only">
        {t("layout.workspace_switcher")}
      </span>
      <div className="flex flex-col items-stretch gap-1 rounded-2xl border border-border bg-card p-1 shadow-md">
        <button
          type="button"
          className="flex h-7 cursor-grab items-center justify-center rounded-lg text-muted-foreground active:cursor-grabbing"
          aria-label={t("layout.drag_switcher")}
          title={t("layout.drag_switcher")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              nudge(-24);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              nudge(24);
            } else if (e.key === "Home") {
              e.preventDefault();
              reset();
            }
          }}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          aria-pressed={pane === "chart"}
          aria-label={t("layout.chart")}
          title={t("layout.chart")}
          onClick={() => onChange("chart")}
          className={cn(
            "flex h-9 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pane === "chart"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <CandlestickChart className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-pressed={pane === "chat"}
          aria-label={t("layout.chat")}
          title={t("layout.chat")}
          onClick={() => onChange("chat")}
          className={cn(
            "flex h-9 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pane === "chat"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <MessageSquare className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={reset}
          className="flex h-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("layout.reset_switcher")}
          title={t("layout.reset_switcher")}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
