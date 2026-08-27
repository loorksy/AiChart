"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  SHEET_ARM_PX,
  SHEET_FLICK_VELOCITY,
  SHEET_SETTLE_EASING,
  SHEET_SETTLE_MS,
  shouldDismissSheet,
} from "@/hooks/sheetGesture";

/**
 * Finger-driven drag for the console's bottom sheets.
 *
 * The first version listened to touchstart/touchend only and re-rendered React
 * state per move — the sheet jumped instead of following, and because nothing
 * claimed the gesture, Chrome read a downward drag at the top of the page as
 * pull-to-refresh and reloaded the app out from under the user. This hook owns
 * the gesture end to end:
 *
 * - Pointer events with capture, and `touch-action: none` on the handle, so the
 *   browser never gets to interpret the drag as scroll or refresh.
 * - Frames are written straight to `style.transform` via rAF — no React state
 *   per move, so the sheet tracks the finger at frame rate.
 * - Transition is applied only on release (spring-ish ease). A long slow pull
 *   past ~35% or a quick flick both dismiss; an upward pull expands to full
 *   height when the sheet supports it.
 */
export function useSheetGesture({
  sheetRef,
  scrollRef,
  onDismiss,
  expandable = false,
  expanded = false,
  onExpandedChange,
  enabled = true,
  enabledQuery,
}: {
  sheetRef: React.RefObject<HTMLElement | null>;
  /** Scrollable body; a downward drag from here only arms when already at top. */
  scrollRef?: React.RefObject<HTMLElement | null>;
  onDismiss: () => void;
  /** Whether an upward pull may grow the sheet to the full viewport. */
  expandable?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  enabled?: boolean;
  /** When set, the gesture is a no-op unless this media query matches. */
  enabledQuery?: string;
}) {
  const gesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
    baseHeight: number;
    captured: boolean;
  } | null>(null);

  const frame = useRef(0);
  const pendingDy = useRef<number | null>(null);
  const settleTimer = useRef<number>(0);

  // Kept in a ref so the move handler never closes over stale props; written
  // in an effect because render must stay pure.
  const latest = useRef({
    onDismiss,
    expandable,
    expanded,
    onExpandedChange,
    enabled,
    enabledQuery,
  });
  useEffect(() => {
    latest.current = {
      onDismiss,
      expandable,
      expanded,
      onExpandedChange,
      enabled,
      enabledQuery,
    };
  });

  const clearInline = useCallback(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transform = "";
    el.style.height = "";
    el.style.transition = "";
    el.style.touchAction = "";
  }, [sheetRef]);

  const cancelFrame = useCallback(() => {
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
    pendingDy.current = null;
  }, []);

  const isEnabled = useCallback(() => {
    const { enabled: on, enabledQuery: query } = latest.current;
    if (!on) return false;
    if (!query) return true;
    return window.matchMedia(query).matches;
  }, []);

  const prefersReducedMotion = useCallback(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // The sheet can close from outside mid-gesture (Esc, backdrop); make sure no
  // half-applied frame survives into the next open.
  useEffect(
    () => () => {
      cancelFrame();
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      clearInline();
    },
    [clearInline, cancelFrame],
  );

  const paint = useCallback(() => {
    frame.current = 0;
    const el = sheetRef.current;
    const dy = pendingDy.current;
    const g = gesture.current;
    if (!el || dy == null || !g) return;
    if (dy >= 0) {
      el.style.height = "";
      el.style.transform = `translateY(${dy}px)`;
    } else if (latest.current.expandable) {
      el.style.transform = "";
      const viewportH = window.visualViewport?.height ?? window.innerHeight;
      el.style.height = `${Math.min(g.baseHeight - dy, viewportH)}px`;
    }
  }, [sheetRef]);

  const schedulePaint = useCallback(
    (dy: number) => {
      pendingDy.current = dy;
      if (frame.current) return;
      frame.current = requestAnimationFrame(paint);
    },
    [paint],
  );

  const begin = useCallback(
    (event: React.PointerEvent, captured: boolean) => {
      const el = sheetRef.current;
      if (!el || gesture.current || !isEnabled()) return false;
      if (settleTimer.current) {
        window.clearTimeout(settleTimer.current);
        settleTimer.current = 0;
      }
      gesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastY: event.clientY,
        lastT: performance.now(),
        velocity: 0,
        baseHeight: el.getBoundingClientRect().height,
        captured,
      };
      if (captured) {
        event.preventDefault();
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        // The finger owns the frame now; easing would fight it.
        el.style.transition = "none";
        el.style.touchAction = "none";
      }
      return true;
    },
    [sheetRef, isEnabled],
  );

  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      begin(event, true);
    },
    [begin],
  );

  const onSurfacePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!isEnabled()) return;
      const scroll = scrollRef?.current;
      if (scroll && scroll.scrollTop > 1) return;
      begin(event, false);
    },
    [begin, isEnabled, scrollRef],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const g = gesture.current;
      const el = sheetRef.current;
      if (!g || !el || event.pointerId !== g.pointerId) return;
      if (!isEnabled()) {
        cancelFrame();
        gesture.current = null;
        clearInline();
        return;
      }

      const now = performance.now();
      const dt = now - g.lastT;
      if (dt > 0) g.velocity = (event.clientY - g.lastY) / dt;
      g.lastY = event.clientY;
      g.lastT = now;

      const dy = event.clientY - g.startY;
      const dx = event.clientX - g.startX;

      if (!g.captured) {
        if (dy < -SHEET_ARM_PX || (Math.abs(dx) > SHEET_ARM_PX && Math.abs(dx) > dy)) {
          gesture.current = null;
          return;
        }
        const scroll = scrollRef?.current;
        if (scroll && scroll.scrollTop > 1) {
          gesture.current = null;
          return;
        }
        if (dy < SHEET_ARM_PX) return;
        g.captured = true;
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        el.style.transition = "none";
        el.style.touchAction = "none";
      }

      event.preventDefault();
      schedulePaint(dy);
    },
    [sheetRef, scrollRef, isEnabled, cancelFrame, clearInline, schedulePaint],
  );

  const settle = useCallback(
    (event: React.PointerEvent) => {
      const g = gesture.current;
      const el = sheetRef.current;
      if (!g || !el || event.pointerId !== g.pointerId) return;
      gesture.current = null;
      cancelFrame();

      if (!g.captured) return;

      const dy = g.lastY - g.startY;
      const reduced = prefersReducedMotion();

      if (shouldDismissSheet({ dy, velocity: g.velocity, height: g.baseHeight })) {
        if (reduced) {
          clearInline();
          latest.current.onDismiss();
          return;
        }
        // Keep the current offset and fold the rest of the way off-screen.
        // Transition only here — during the drag it was `none`.
        el.style.transition = `transform ${SHEET_SETTLE_MS}ms ${SHEET_SETTLE_EASING}`;
        el.style.transform = `translateY(${g.baseHeight}px)`;
        latest.current.onDismiss();
        settleTimer.current = window.setTimeout(() => {
          settleTimer.current = 0;
          clearInline();
        }, SHEET_SETTLE_MS + 40);
        return;
      }

      if (
        dy < 0 &&
        latest.current.expandable &&
        (g.velocity < -SHEET_FLICK_VELOCITY ||
          -dy >
            ((window.visualViewport?.height ?? window.innerHeight) - g.baseHeight) * 0.4)
      ) {
        clearInline();
        latest.current.onExpandedChange?.(true);
        return;
      }

      // A short downward pull on an expanded sheet steps back to the resting
      // height first; dismissal is the next pull, not the same one.
      if (dy > 0 && latest.current.expanded) {
        clearInline();
        latest.current.onExpandedChange?.(false);
        return;
      }

      if (reduced || dy <= 0) {
        clearInline();
        return;
      }

      el.style.transition = `transform ${SHEET_SETTLE_MS}ms ${SHEET_SETTLE_EASING}`;
      el.style.transform = "translateY(0px)";
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = 0;
        clearInline();
      }, SHEET_SETTLE_MS + 40);
    },
    [sheetRef, cancelFrame, clearInline, prefersReducedMotion],
  );

  const handleStyle = { touchAction: "none" } as const;

  return {
    handleProps: {
      onPointerDown: onHandlePointerDown,
      onPointerMove,
      onPointerUp: settle,
      onPointerCancel: settle,
      // The browser must never read this surface as scrollable — that is
      // exactly how the drag used to turn into pull-to-refresh.
      style: handleStyle,
    },
    surfaceProps: {
      onPointerDown: onSurfacePointerDown,
      onPointerMove,
      onPointerUp: settle,
      onPointerCancel: settle,
    },
  };
}
