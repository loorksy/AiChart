"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import {
  isPinnedToBottom,
  scrollChatToBottom,
} from "@/lib/layout/chatScroll";

/**
 * Keep the conversation scroller on the latest turn while the operator is
 * following, and stay put when they scroll up to read history.
 *
 * `followKey` should change whenever the thread grows (new message, stream
 * token, stage, hydration). `pin()` is called from send so a new question
 * always reveals the reply that follows it.
 */
export function useChatStickToBottom(
  enabled: boolean,
  followKey: string,
  resetKey = "",
) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useLayoutEffect(() => {
    pinnedRef.current = true;
  }, [resetKey]);

  const follow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !pinnedRef.current) return;
    scrollChatToBottom(el);
  }, []);

  const pin = useCallback(() => {
    pinnedRef.current = true;
    follow();
  }, [follow]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current = isPinnedToBottom(el);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return;
    follow();
  }, [enabled, follow, followKey]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollChatToBottom(el);
    });
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [enabled, followKey]);

  return { scrollerRef, pin };
}
