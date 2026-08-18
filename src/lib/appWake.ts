/**
 * One browser-wide "the tab is back / the network is back" signal.
 *
 * Live pipes (chart ticks, alerts, /api/me, the agent stream) used to die
 * silently: EventSource.onerror closed the socket and nothing reopened it
 * while the tab stayed visible, and a single failed /api/me wipe looked like
 * a logout. Consumers listen for `aichart:app-wake` and reconnect.
 */
export const APP_WAKE_EVENT = "aichart:app-wake";

const TICK_RECONNECT_BASE_MS = 400;
const TICK_RECONNECT_MAX_MS = 8_000;

let started = false;

/** Exponential backoff for a dropped live socket. Attempt 0 → 400ms. */
export function tickReconnectDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(TICK_RECONNECT_MAX_MS, TICK_RECONNECT_BASE_MS * 2 ** n);
}

export function dispatchAppWake(): void {
  if (typeof window === "undefined") return;
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

  window.addEventListener("online", wake);
  window.addEventListener("pageshow", wake);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    started = false;
    window.removeEventListener("online", wake);
    window.removeEventListener("pageshow", wake);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
