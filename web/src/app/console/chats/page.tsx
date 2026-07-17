"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, MessagesSquare, Search, Trash2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { AgentChatSession } from "@/lib/agent/chatHistory/types";

/** Dedicated Chat History destination — not a permanent second sidebar column. */
export default function ChatHistoryPage() {
  const { t, dir } = useLocale();
  const router = useRouter();
  const [sessions, setSessions] = useState<AgentChatSession[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const refresh = useCallback((signal?: AbortSignal) => {
    return fetch("/api/agent/chats", { signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { sessions?: AgentChatSession[] } | null) => {
        if (!data) return;
        startTransition(() => {
          setSessions(data.sessions ?? []);
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.lastMessagePreview ?? "").toLowerCase().includes(q) ||
        (s.symbol ?? "").toLowerCase().includes(q),
    );
  }, [sessions, query]);

  async function startNew() {
    setBusy(true);
    try {
      const res = await fetch("/api/agent/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        const data = (await res.json()) as { session?: { id: string } };
        if (data.session?.id) {
          localStorage.setItem("lonora_active_chat", data.session.id);
        }
      }
      router.push("/console");
    } finally {
      setBusy(false);
    }
  }

  function openChat(id: string) {
    localStorage.setItem("lonora_active_chat", id);
    window.dispatchEvent(new CustomEvent("aichart:select-chat", { detail: { id } }));
    router.push("/console");
  }

  async function removeChat(id: string) {
    const res = await fetch(`/api/agent/chats/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      window.dispatchEvent(new Event("aichart:chats-updated"));
    }
  }

  return (
    <div dir={dir} className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">{t("chats.title")}</h1>
        <button
          type="button"
          disabled={busy}
          onClick={() => void startNew()}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {t("nav.new_chat")}
        </button>
      </div>

      <label className="relative block">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("chats.search_placeholder")}
          className="min-h-10 w-full rounded-lg border border-border bg-card pe-3 ps-9 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <div className="aichart-scroll min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-2">
        {filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("nav.no_chats")}</p>
        ) : (
          filtered.map((session) => (
            <div
              key={session.id}
              className="group flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-muted"
            >
              <button
                type="button"
                onClick={() => openChat(session.id)}
                className="flex min-w-0 flex-1 items-start gap-3 text-start"
                aria-label={t("chats.open")}
              >
                <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {session.title}
                  </span>
                  {session.lastMessagePreview ? (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {session.lastMessagePreview}
                    </span>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void removeChat(session.id)}
                className="rounded-md p-2 text-muted-foreground opacity-70 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                aria-label={t("nav.delete_chat")}
                title={t("nav.delete_chat")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
