"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Invisible heartbeat for public pages only. Mounted from PublicChrome —
 * never from the authenticated console or /chat.
 */
const ENDPOINT = "/api/public/presence";
const INTERVAL_MS = 30_000;

function ping(path: string, preferBeacon: boolean): void {
  const body = JSON.stringify({ path });
  if (preferBeacon && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    } catch {
      /* fall through to fetch */
    }
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {
    /* fail silent — never surface on the landing */
  });
}

export function VisitorBeacon() {
  const pathname = usePathname() ?? "/";
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    const send = (beacon: boolean) => {
      if (typeof document !== "undefined" && document.hidden && !beacon) return;
      ping(pathRef.current, beacon);
    };

    send(false);
    const id = window.setInterval(() => send(false), INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) send(false);
    };
    const onPageHide = () => send(true);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  return null;
}
