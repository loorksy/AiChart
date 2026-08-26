/**
 * One browser-wide "the tab is back / the network is back" signal.
 *
 * Live pipes (chart ticks, alerts, /api/me, the agent stream) used to die
 * silently: EventSource.onerror closed the socket and nothing reopened it
 * while the tab stayed visible, and a single failed /api/me wipe looked like
 * a logout. Consumers listen for `aichart:app-wake` and reconnect.
 *
 * Mobile is the hard case. Android Chrome freezes timers AND kills sockets in
 * the background, and on some devices the return path fires `focus` or
 * nothing at all instead of `visibilitychange`. The bridge therefore listens
 * on every resume-shaped event (visibilitychange, pageshow, focus, online)
 * AND runs a suspend detector: a short interval whose wall-clock gap jumping
 * far past its period proves the page was frozen, whatever events did or
 * did not fire.
 */
export const APP_WAKE_EVENT = "aichart:app-wake";

const TICK_RECONNECT_BASE_MS = 400;
const TICK_RECONNECT_MAX_MS = 8_000;

/** Suspend detector cadence. */
export const SUSPEND_CHECK_MS = 5_000;

/**
 * Wall-clock gap between two detector runs that proves the page was frozen.
 * Ordinary timer throttling in a VISIBLE tab stays near the period; only a
 * background freeze / device sleep stretches it this far.
 */
export const SUSPEND_GAP_MS = 20_000;

/** Collapse the burst of resume events (visibility + focus + pageshow all
 *  fire together) into one wake so pipes are not torn down three times. */
const WAKE_DEDUPE_MS = 1_000;

let started = false;
let lastWakeAt = 0;

/** Exponential backoff for a dropped live socket. Attempt 0 → 400ms. */
export function tickReconnectDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(TICK_RECONNECT_MAX_MS, TICK_RECONNECT_BASE_MS * 2 ** n);
}

/**
 * Did the page sleep between two runs of the suspend detector?
 * `elapsedMs` is the wall-clock time since the previous run.
 */
export function suspendGapDetected(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs > SUSPEND_CHECK_MS + SUSPEND_GAP_MS;
}

export function dispatchAppWake(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastWakeAt < WAKE_DEDUPE_MS) return;
  lastWakeAt = now;
  window.dispatchEvent(new Event(APP_WAKE_EVENT));
}

/**
 * Idempotent. Safe to call from more than one mount; the second call is a
 * no-op until the first disposer runs.
 */
export function startAppWakeBridge(): () => void {
  if (typeof window === "undefined") return () => {};
  if (started) return () => {};
  started = true;

  const wake = () => dispatchAppWake();
  const onVisible = () => {
    if (document.visibilityState === "visible") wake();
  };

  // Catch-all for phones where NO resume event reaches the page: timers
  // freeze in the background, so the first run after wake sees a wall-clock
  // jump far beyond the period — that jump IS the wake signal.
  let lastRunAt = Date.now();
  const suspendTimer = setInterval(() => {
    const now = Date.now();
    const elapsed = now - lastRunAt;
    lastRunAt = now;
    if (
      suspendGapDetected(elapsed) &&
      document.visibilityState === "visible"
    ) {
      wake();
    }
  }, SUSPEND_CHECK_MS);

  window.addEventListener("online", wake);
  window.addEventListener("pageshow", wake);
  window.addEventListener("focus", onVisible);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    started = false;
    clearInterval(suspendTimer);
    window.removeEventListener("online", wake);
    window.removeEventListener("pageshow", wake);
    window.removeEventListener("focus", onVisible);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
