"use client";

import { useEffect } from "react";

/** Fired when a backgrounded tab wakes — chart streams and polls re-arm. */
export const APP_WAKE_EVENT = "aichart:app-wake";

/**
 * Keeps mt_presence warm while a console tab is open, and recovers after idle.
 *
 * Browsers suspend timers in background tabs, so a 4-minute interval alone
 * looks like a dropped network after the operator returns. On visibility
 * wake we: beat immediately, dispatch APP_WAKE_EVENT so the chart datafeed
 * reopens its SSE tick stream, and restart the interval clock.
 */
export function Mt5PresencePing() {
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const beat = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/mt5/heartbeat", { method: "POST" }).catch(() => {});
    };

    const armInterval = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(beat, 4 * 60 * 1000);
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      beat();
      armInterval();
      window.dispatchEvent(new CustomEvent(APP_WAKE_EVENT));
    };

    beat();
    armInterval();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onVisibility);
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onVisibility);
    };
  }, []);
  return null;
}
