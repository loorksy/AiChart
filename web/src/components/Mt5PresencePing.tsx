"use client";

import { useEffect } from "react";

/**
 * V2-B (#96): keeps mt_presence warm while a console tab is open.
 * Beats on mount, every 4 minutes, and whenever the tab becomes visible
 * again — the 15-minute idle grace on the server does the rest. Silent by
 * design: failures are irrelevant to the UI.
 */
export function Mt5PresencePing() {
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/mt5/heartbeat", { method: "POST" }).catch(() => {});
    };
    beat();
    const interval = setInterval(beat, 4 * 60 * 1000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);
  return null;
}
