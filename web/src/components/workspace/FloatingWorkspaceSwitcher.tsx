"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CandlestickChart,
  ChevronDown,
  GripVertical,
  MessageSquare,
  RotateCcw,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";
import type { MobilePane } from "@/lib/layout/chatLayout";
import {
  SWITCHER_COLLAPSED_SIZE,
  SWITCHER_DRAG_THRESHOLD_PX,
  SWITCHER_HEIGHT,
  SWITCHER_WIDTH,
  clampSwitcherPoint,
  defaultSwitcherPosition,
  loadSwitcherPosition,
  positionForDock,
  resolveDockFromPoint,
  saveSwitcherPosition,
  type SwitcherPosition,
} from "@/lib/layout/workspaceSwitcher";
import { cn } from "@/lib/utils";

/**
 * Free-drag Chart ↔ Chat switcher for narrow viewports.
 * Can float anywhere, merge into the composer, dock at the top, and collapse compactly.
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
  const localeDir = dir === "rtl" ? "rtl" : "ltr";
  const [pos, setPos] = useState<SwitcherPosition>(() =>
    defaultSwitcherPosition(localeDir),
  );
  const [composerHost, setComposerHost] = useState<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragging: boolean;
  } | null>(null);
  const skipClickRef = useRef(false);

  const viewport = () => ({
    w: typeof window !== "undefined" ? window.innerWidth : 390,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  });

  useEffect(() => {
    const { w, h } = viewport();
    setPos(loadSwitcherPosition(localeDir, w, h));
  }, [localeDir]);

  useLayoutEffect(() => {
    const find = () =>
      document.querySelector<HTMLElement>('[data-switcher-dock="composer"]');
    setComposerHost(find());
    const observer = new MutationObserver(() => setComposerHost(find()));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onResize = () => {
      const { w, h } = viewport();
      setPos((prev) => {
        const size = sizeFor(prev);
        const point = clampSwitcherPoint(prev.x, prev.y, w, h, size);
        const next = { ...prev, ...point };
        saveSwitcherPosition(next, w, h);
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const applyPos = useCallback((next: SwitcherPosition) => {
    const { w, h } = viewport();
    const size = sizeFor(next);
    const point = clampSwitcherPoint(next.x, next.y, w, h, size);
    const clamped = { ...next, ...point };
    setPos(clamped);
    saveSwitcherPosition(clamped, w, h);
  }, []);

  const reset = () => {
    const { w, h } = viewport();
    applyPos(defaultSwitcherPosition(localeDir, w, h));
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pos.x,
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
    if (!drag.dragging) {
      drag.dragging = true;
      setDragging(true);
    }
    const { w, h } = viewport();
    const size = sizeFor({ ...pos, dock: "free", collapsed: pos.collapsed });
    const point = clampSwitcherPoint(drag.originX + dx, drag.originY + dy, w, h, size);
    setPos((prev) => ({ ...prev, ...point, dock: "free" }));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    if (!drag.dragging) return;
    skipClickRef.current = true;
    const { w, h } = viewport();
    const x = drag.originX + (event.clientX - drag.startX);
    const y = drag.originY + (event.clientY - drag.startY);
    const dock = resolveDockFromPoint(x, y, w, h);
    if (dock === "free") {
      const point = clampSwitcherPoint(x, y, w, h, sizeFor({ ...pos, dock: "free" }));
      applyPos({ ...pos, ...point, dock: "free" });
      return;
    }
    const docked = positionForDock(dock, w, h, pos.collapsed);
    applyPos({ ...pos, ...docked, dock });
  };

  const nudge = (dx: number, dy: number) => {
    applyPos({ ...pos, x: pos.x + dx, y: pos.y + dy, dock: "free" });
  };

  const toggleCollapsed = () => {
    const nextCollapsed = !pos.collapsed;
    const { w, h } = viewport();
    if (pos.dock === "free") {
      applyPos({ ...pos, collapsed: nextCollapsed });
      return;
    }
    const docked = positionForDock(pos.dock, w, h, nextCollapsed);
    applyPos({ ...pos, ...docked, collapsed: nextCollapsed });
  };

  const chrome = (
    <SwitcherChrome
      pane={pane}
      onChange={onChange}
      collapsed={pos.collapsed}
      horizontal={pos.dock !== "free" || pos.collapsed}
      merged={pos.dock === "composer" && !dragging}
      labelId={labelId}
      label={t("layout.workspace_switcher")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onReset={reset}
      onToggleCollapsed={() => {
        if (skipClickRef.current) {
          skipClickRef.current = false;
          return;
        }
        toggleCollapsed();
      }}
      onNudge={nudge}
      t={t}
    />
  );

  // Only portal into the composer while chat is visible; otherwise the dock
  // host is `hidden` on mobile chart and would swallow the switcher.
  const mergedIntoComposer =
    pos.dock === "composer" &&
    !dragging &&
    pane === "chat" &&
    composerHost != null;

  if (mergedIntoComposer) {
    return createPortal(
      <div
        data-testid="chart-chat-switcher"
        data-dock="composer"
        data-collapsed={pos.collapsed ? "true" : "false"}
        className="xl:hidden"
      >
        {chrome}
      </div>,
      composerHost,
    );
  }

  const size = sizeFor(pos);
  const style: React.CSSProperties = {
    position: "fixed",
    left: pos.x,
    top: pos.y,
    width: size.w,
    minHeight: size.h,
    zIndex: 45,
    touchAction: "none",
  };

  return (
    <div
      data-testid="chart-chat-switcher"
      data-dock={pos.dock}
      data-collapsed={pos.collapsed ? "true" : "false"}
      role="toolbar"
      aria-labelledby={labelId}
      className="xl:hidden"
      style={style}
    >
      {chrome}
    </div>
  );
}

function sizeFor(pos: Pick<SwitcherPosition, "dock" | "collapsed">) {
  if (pos.collapsed) {
    return { w: SWITCHER_COLLAPSED_SIZE, h: SWITCHER_COLLAPSED_SIZE };
  }
  if (pos.dock === "free") {
    return { w: SWITCHER_WIDTH, h: SWITCHER_HEIGHT };
  }
  return { w: 148, h: 40 };
}

function SwitcherChrome({
  pane,
  onChange,
  collapsed,
  horizontal,
  merged,
  labelId,
  label,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onReset,
  onToggleCollapsed,
  onNudge,
  t,
}: {
  pane: MobilePane;
  onChange: (pane: MobilePane) => void;
  collapsed: boolean;
  horizontal: boolean;
  merged: boolean;
  labelId: string;
  label: string;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onReset: () => void;
  onToggleCollapsed: () => void;
  onNudge: (dx: number, dy: number) => void;
  t: (key: TranslationKey) => string;
}) {
  if (collapsed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full border border-border bg-card shadow-sm",
          merged ? "h-8 w-8" : "h-10 w-10",
        )}
      >
        <span id={labelId} className="sr-only">
          {label}
        </span>
        <button
          type="button"
          className="flex h-full w-full cursor-grab items-center justify-center text-foreground active:cursor-grabbing"
          aria-label={t("layout.expand_switcher")}
          title={t("layout.expand_switcher")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={(e) => {
            e.preventDefault();
            onToggleCollapsed();
          }}
        >
          {pane === "chart" ? (
            <CandlestickChart className="h-3.5 w-3.5" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border border-border bg-card shadow-sm",
        horizontal
          ? cn(
              "flex items-center gap-0.5 rounded-full p-0.5",
              merged && "border-transparent bg-muted/70 shadow-none",
            )
          : "flex flex-col items-stretch gap-0.5 rounded-2xl p-1",
      )}
    >
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <button
        type="button"
        className={cn(
          "flex cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing",
          horizontal ? "h-8 w-7 rounded-full" : "h-7 rounded-lg",
        )}
        aria-label={t("layout.drag_switcher")}
        title={t("layout.drag_switcher")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onNudge(0, -24);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onNudge(0, 24);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            onNudge(-24, 0);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onNudge(24, 0);
          } else if (e.key === "Home") {
            e.preventDefault();
            onReset();
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
          "flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          horizontal ? "h-8 w-8 rounded-full" : "h-9 rounded-xl",
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
          "flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          horizontal ? "h-8 w-8 rounded-full" : "h-9 rounded-xl",
          pane === "chat"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <MessageSquare className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onToggleCollapsed}
        className={cn(
          "flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          horizontal ? "h-8 w-7 rounded-full" : "h-7 rounded-lg",
        )}
        aria-label={t("layout.collapse_switcher")}
        title={t("layout.collapse_switcher")}
      >
        <ChevronDown className={cn("h-3 w-3", horizontal && "rotate-0")} />
      </button>

      {!horizontal && (
        <button
          type="button"
          onClick={onReset}
          className="flex h-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("layout.reset_switcher")}
          title={t("layout.reset_switcher")}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
