"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  chatConsoleHref,
  parseChatIdFromSearchParams,
  WORKSPACE_HOME_HREF,
} from "@/lib/chatUrl";

export function useConsoleChatUrl(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlChatId = enabled ? parseChatIdFromSearchParams(searchParams) : null;

  const syncChatUrl = useCallback(
    (chatId: string | null, mode: "push" | "replace") => {
      if (!enabled) return;
      const href = chatId ? chatConsoleHref(chatId) : WORKSPACE_HOME_HREF;
      if (mode === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [enabled, router],
  );

  return { urlChatId, syncChatUrl };
}
