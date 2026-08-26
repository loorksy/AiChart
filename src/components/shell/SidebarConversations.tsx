"use client";

import { SidebarListSkeleton } from "@/components/ui/skeletons/page-skeletons";
import { Suspense, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, MessageSquarePlus, Search, Trash2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { AgentChatSession } from "@/lib/agent/chatHistory/types";
import {
  chatConsoleHref,
  LS_ACTIVE_CHAT,
  parseChatIdFromSearchParams,
} from "@/lib/chatUrl";
import { formatMessageStamp } from "@/lib/display/timestamp";
import { cn } from "@/lib/utils";

function formatUpdated(ts: number, locale: string): string {
  try {
    // The shared RTL-safe stamp: "today + clock" for recent rows, a wordy
    // month for older ones, every fragment bidi-isolated so the RTL rail can
    // never scramble it.
    return formatMessageStamp(ts, locale === "en" ? "en" : "ar");
  } catch {
    return "";
  }
}

/**
 * Conversation section inside the canonical sidebar/drawer.
 * Not a separate product page — shares one navigation surface.
 */
export function SidebarConversations({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <SidebarConversationsInner collapsed={collapsed} onNavigate={onNavigate} />
    </Suspense>
  );
}

function SidebarConversationsInner({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { t, dir, locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlChatId = parseChatIdFromSearchParams(searchParams);
  const [sessions, setSessions] = useState<AgentChatSession[]>([]);
  /** Distinguishes "still loading" from "genuinely no conversations". */
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const activeId = urlChatId;

  const refresh = useCallback((signal?: AbortSignal) => {
    return fetch("/api/agent/chats", { signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { sessions?: AgentChatSession[] } | null) => {
        if (!data) return;
        startTransition(() => setSessions(data.sessions ?? []));
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    const onUpdated = () => void refresh();
    window.addEventListener("aichart:chats-updated", onUpdated);
    return () => {
      ac.abort();
      window.removeEventListener("aichart:chats-updated", onUpdated);
    };
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.lastMessagePreview ?? "").toLowerCase().includes(q),
    );
  }, [sessions, query]);

  async function startNew() {
    setBusy(true);
    try {
      window.dispatchEvent(new Event("aichart:new-chat"));
      if (pathname !== "/chat") router.push("/chat");
      onNavigate?.();
    } finally {
      setBusy(false);
    }
  }

  function openChat(id: string) {
    router.push(chatConsoleHref(id), { scroll: false });
    onNavigate?.();
  }

  async function removeChat(id: string) {
    const res = await fetch(`/api/agent/chats/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    const nextSessions = sessions.filter((s) => s.id !== id);
    setSessions(nextSessions);
    if (activeId === id) {
      const fallback = nextSessions[0];
      if (fallback) router.replace(chatConsoleHref(fallback.id), { scroll: false });
      else {
        router.replace("/chat", { scroll: false });
        window.dispatchEvent(new Event("aichart:new-chat"));
      }
      try {
        localStorage.removeItem(LS_ACTIVE_CHAT);
      } catch {
        /* ignore */
      }
    }
    window.dispatchEvent(new Event("aichart:chats-updated"));
  }

  if (collapsed && !onNavigate) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-sidebar-border py-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void startNew()}
          title={t("nav.new_chat")}
          aria-label={t("nav.new_chat")}
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      dir={dir}
      data-testid="canonical-chats-section"
      className="flex min-h-0 flex-1 flex-col border-t border-sidebar-border"
    >
      <div className="shrink-0 space-y-2 px-2 py-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void startNew()}
          className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          <MessageSquarePlus className="h-4 w-4 shrink-0" />
          {t("nav.new_chat")}
        </button>
        <label className="relative block">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chats.search_placeholder")}
            aria-label={t("chats.search_placeholder")}
            className="min-h-9 w-full rounded-lg border border-border bg-background pe-2 ps-8 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("nav.chats")}
        </p>
      </div>

      <nav
        aria-label={t("nav.chats")}
        className="aichart-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2"
      >
        {!loaded && filtered.length === 0 ? (
          // The list's own shape while it loads — "no conversations yet" is a
          // statement of fact and must not be shown before it is one.
          <SidebarListSkeleton rows={5} />
        ) : filtered.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            {t("nav.no_chats")}
          </p>
        ) : (
          filtered.map((session) => {
            const active = session.id === activeId;
            return (
              <div
                key={session.id}
                className={cn(
                  "group flex items-start gap-1 rounded-lg px-1.5 py-1.5",
                  active ? "bg-[var(--sidebar-active-bg)]" : "hover:bg-muted",
                )}
              >
                <button
                  type="button"
                  onClick={() => openChat(session.id)}
                  aria-current={active ? "true" : undefined}
                  className="flex min-w-0 flex-1 items-start gap-2 text-start"
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {session.title}
                    </span>
                    {session.lastMessagePreview ? (
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {session.lastMessagePreview}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block text-[10px] text-muted-foreground/80">
                      {formatUpdated(session.updatedAt, locale)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void removeChat(session.id)}
                  className="rounded-md p-1.5 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                  aria-label={t("nav.delete_chat")}
                  title={t("nav.delete_chat")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </nav>
    </div>
  );
}
