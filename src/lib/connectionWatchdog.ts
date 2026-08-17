/**
 * Active probe of the app origin. `online` / visibility do not fire when the
 * HTTP/2 socket to nginx dies while the tab stays in the foreground — the
 * watchdog is what notices, marks the link down, and wakes every live pipe.
 */
import { dispatchAppWake } from "@/lib/appWake";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

export type ServerLinkState = "up" | "down";

const PING_MS = 12_000;
const TIMEOUT_MS = 4_000;
const FAILS_BEFORE_DOWN = 2;

let started = false;
let state: ServerLinkState = "up";
const listeners = new Set<(next: ServerLinkState) => void>();

export function getServerLink(): ServerLinkState {
  return state;
}

export function subscribeServerLink(
  listener: (next: ServerLinkState) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setState(next: ServerLinkState): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      /* a broken subscriber must not stop the probe */
    }
  }
}

export function startConnectionWatchdog(): () => void {
  if (typeof window === "undefined") return () => {};
  if (started) return () => {};
  started = true;

  let fails = 0;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const ping = async () => {
    if (inFlight) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    inFlight = true;
    try {
      const res = await fetchWithTimeout(`/api/healthz?t=${Date.now()}`, {
        timeoutMs: TIMEOUT_MS,
      });
      if (!res.ok) throw new Error("health");
      fails = 0;
      const wasDown = state === "down";
      setState("up");
      if (wasDown) dispatchAppWake();
    } catch {
      fails += 1;
      if (fails >= FAILS_BEFORE_DOWN) {
        setState("down");
        dispatchAppWake();
      }
    } finally {
      inFlight = false;
    }
  };

  void ping();
  timer = setInterval(() => void ping(), PING_MS);

  const onVisible = () => {
    if (document.visibilityState === "visible") void ping();
  };
  window.addEventListener("online", ping);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    started = false;
    if (timer) clearInterval(timer);
    window.removeEventListener("online", ping);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
