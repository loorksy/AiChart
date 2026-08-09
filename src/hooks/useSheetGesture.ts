"use client";

import { useCallback, useEffect, useRef } from "react";

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
 * - Frames are written straight to `style.transform`/`style.height` — no React
 *   state per move, so the sheet tracks the finger at frame rate.
 * - Release snaps by distance AND velocity: a long slow pull past 30% or a
 *   quick flick both dismiss; an upward pull expands to full height when the
 *   sheet supports it.
 */
export function useSheetGesture({
  sheetRef,
  onDismiss,
  expandable = false,
  expanded = false,
  onExpandedChange,
}: {
  sheetRef: React.RefObject<HTMLElement | null>;
  onDismiss: () => void;
  /** Whether an upward pull may grow the sheet to the full viewport. */
  expandable?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const gesture = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
    baseHeight: number;
  } | null>(null);

  // Kept in a ref so the move handler never closes over stale props; written
  // in an effect because render must stay pure.
  const latest = useRef({ onDismiss, expandable, expanded, onExpandedChange });
  useEffect(() => {
    latest.current = { onDismiss, expandable, expanded, onExpandedChange };
  });

  const clearInline = useCallback(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transform = "";
    el.style.height = "";
    el.style.transition = "";
  }, [sheetRef]);

  // The sheet can close from outside mid-gesture (Esc, backdrop); make sure no
  // half-applied frame survives into the next open.
  useEffect(() => () => clearInline(), [clearInline]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const el = sheetRef.current;
      if (!el || gesture.current) return;
      event.preventDefault();
      (event.target as Element).setPointerCapture?.(event.pointerId);
      gesture.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        lastT: performance.now(),
        velocity: 0,
        baseHeight: el.getBoundingClientRect().height,
      };
      // The finger owns the frame now; easing would fight it.
      el.style.transition = "none";
    },
    [sheetRef],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const g = gesture.current;
      const el = sheetRef.current;
      if (!g || !el || event.pointerId !== g.pointerId) return;
      const now = performance.now();
      const dt = now - g.lastT;
      if (dt > 0) g.velocity = (event.clientY - g.lastY) / dt;
      g.lastY = event.clientY;
      g.lastT = now;

      const dy = event.clientY - g.startY;
      if (dy >= 0) {
        // Downward: the whole sheet follows the finger toward dismissal.
        el.style.height = "";
        el.style.transform = `translateY(${dy}px)`;
      } else if (latest.current.expandable) {
        // Upward: the top edge follows the finger until the sheet fills the
        // viewport. Height, not transform — the bottom edge must stay put.
        el.style.transform = "";
        el.style.height = `${Math.min(g.baseHeight - dy, window.innerHeight)}px`;
      }
    },
    [sheetRef],
  );

  const settle = useCallback(
    (event: React.PointerEvent) => {
      const g = gesture.current;
      const el = sheetRef.current;
      if (!g || !el || event.pointerId !== g.pointerId) return;
      gesture.current = null;

      const dy = g.lastY - g.startY;
      const flickDown = g.velocity > 0.5;
      const flickUp = g.velocity < -0.5;
      clearInline();

      if (dy > 0 && (flickDown || dy > g.baseHeight * 0.3)) {
        latest.current.onDismiss();
        return;
      }
      if (
        dy < 0 &&
        latest.current.expandable &&
        (flickUp || -dy > (window.innerHeight - g.baseHeight) * 0.4)
      ) {
        latest.current.onExpandedChange?.(true);
        return;
      }
      // A short downward pull on an expanded sheet steps back to the resting
      // height first; dismissal is the next pull, not the same one.
      if (dy > 0 && latest.current.expanded) {
        latest.current.onExpandedChange?.(false);
      }
    },
    [sheetRef, clearInline],
  );

  return {
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: settle,
      onPointerCancel: settle,
      // The browser must never read this surface as scrollable — that is
      // exactly how the drag used to turn into pull-to-refresh.
      style: { touchAction: "none" } as const,
    },
  };
}
