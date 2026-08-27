/**
 * Pure settle math for bottom-sheet dismiss.
 *
 * The pointer hook writes `translateY` on the sheet while the finger moves.
 * On release this decides whether that drag was a close (distance or flick)
 * or a snap-back. Kept out of the React module so the thresholds can be
 * unit-tested without a DOM.
 */

/** Fraction of sheet height that counts as a committed downward drag (~30–40%). */
export const SHEET_DISMISS_RATIO = 0.35;

/** Downward velocity in px/ms that counts as a flick (~500px/s). */
export const SHEET_FLICK_VELOCITY = 0.5;

/** Pixels of downward travel before a body-surface drag claims the gesture. */
export const SHEET_ARM_PX = 8;

export const SHEET_SETTLE_MS = 280;

/** iOS-like decelerate — used only on release, never while following the finger. */
export const SHEET_SETTLE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

export function shouldDismissSheet({
  dy,
  velocity,
  height,
  dismissRatio = SHEET_DISMISS_RATIO,
  flickVelocity = SHEET_FLICK_VELOCITY,
}: {
  dy: number;
  velocity: number;
  height: number;
  dismissRatio?: number;
  flickVelocity?: number;
}): boolean {
  if (!(height > 0) || !(dy > 0)) return false;
  return velocity > flickVelocity || dy > height * dismissRatio;
}
