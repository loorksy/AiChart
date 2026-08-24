"use client";

import { useCallback, useEffect, useState } from "react";

const EVENT = "lonora:support-read";

/** Tell every mounted badge that the conversation was just opened. */
export function notifySupportRead(): void {
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* SSR / detached — nothing to refresh */
  }
}

/**
 * How many support messages are waiting for this person.
 *
 * It asks with `?peek=1`, which is the whole reason that parameter exists: a
 * badge that had to OPEN the conversation to count it would clear the very
 * thing it is counting, and the number would always be zero.
 *
 * Polled rather than pushed. Support is a slow conversation by nature, so a
 * minute is soon enough, and it costs one tiny query — while the SSE channel
 * this app already runs is reserved for the agent's own turns.
 */
export function useSupportUnread(pollMs = 60_000): number {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    fetch("/api/support/conversation?peek=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; unread?: number } | null) => {
        if (data?.ok) setUnread(Number(data.unread ?? 0));
      })
      .catch(() => {
        /* offline or signed out — the badge simply does not appear */
      });
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, pollMs);
    const onRead = () => setUnread(0);
    window.addEventListener(EVENT, onRead);
    return () => {
      clearInterval(timer);
      window.removeEventListener(EVENT, onRead);
    };
  }, [refresh, pollMs]);

  return unread;
}
