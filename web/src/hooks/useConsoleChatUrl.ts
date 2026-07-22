"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  chatConsoleHref,
  parseChatIdFromSearchParams,
} from "@/lib/chatUrl";

export function useConsoleChatUrl(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlChatId = enabled ? parseChatIdFromSearchParams(searchParams) : null;

  const syncChatUrl = useCallback(
    (chatId: string, mode: "push" | "replace") => {
      if (!enabled) return;
      const href = chatConsoleHref(chatId);
      if (mode === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [enabled, router],
  );

  return { urlChatId, syncChatUrl };
}
