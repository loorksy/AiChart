"use client";

/**
 * Quant Agent Chat panel (plan §4) — the center chat surface: header,
 * scrollable message list with an empty-state welcome screen offering a few
 * quick-start prompts, composer fixed at the bottom. Combined with
 * `QuantAgentChatSidebar` in `chat/page.tsx`'s two-column grid (a right rail
 * is explicitly out of scope for v1).
 *
 * Original layout/interaction PATTERN only — no code or markup copied from
 * QuantDinger-Vue's `CopilotWorkbench.vue` (commercially licensed, not
 * reusable). Built with AiChart's own components and `DESIGN.md` tokens.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, RefreshCw, Sparkles } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { consumeSse } from "@/lib/sse";
import { EmptyState } from "@/components/foundation";
import type { AgentChatMessageRecord, AgentChatSession } from "@/lib/agent/chatHistory/types";
import type { QuantAgentChatTurnResult } from "@/lib/agent/quantAgentChat/types";
import { QuantAgentChatComposer } from "./QuantAgentChatComposer";
import { QuantAgentChatSidebar } from "./QuantAgentChatSidebar";
import { QuantAgentChatMessage, type QuantAgentChatMessageData } from "./QuantAgentChatMessage";

/** Matches Lonora's own chat: a concrete active symbol, never an unset one. */
const DEFAULT_QUANT_AGENT_SYMBOL = "EURUSD";

interface StoredMessageResult {
  usedSkills?: QuantAgentChatMessageData["usedSkills"];
  strategyProposal?: QuantAgentChatMessageData["strategyProposal"];
  memoryCandidate?: QuantAgentChatMessageData["memoryCandidate"];
  recommendations?: QuantAgentChatMessageData["recommendations"];
}

function toDisplayMessage(record: AgentChatMessageRecord): QuantAgentChatMessageData {
  const result = record.result as StoredMessageResult | undefined;
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    usedSkills: result?.usedSkills,
    strategyProposal: result?.strategyProposal ?? null,
    memoryCandidate: result?.memoryCandidate ?? null,
    recommendations: result?.recommendations,
    createdAt: record.createdAt,
  };
}

const QUICK_START_KEYS = [
  "qa.chat.quickstart.explain",
  "qa.chat.quickstart.generate",
  "qa.chat.quickstart.how_it_works",
] as const;

export function QuantAgentChatPanel() {
  const { t, dir, locale } = useLocale();
  const [sessions, setSessions] = useState<AgentChatSession[] | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<QuantAgentChatMessageData[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  /**
   * The pair the next question/analysis is scoped to (Gap 1) — mirrors
   * Lonora's own `symbol` state in `SmartChartWorkspace.tsx`, lifted here so
   * both the composer's `ComposerSymbolPicker` and the outgoing request body
   * read the same value. Quant Agent never touches broker accounts, so
   * `brokerConnected` is a safe, honest `false` (see `QuantAgentChatComposer`).
   */
  const [symbol, setSymbol] = useState(DEFAULT_QUANT_AGENT_SYMBOL);
  const listRef = useRef<HTMLDivElement | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/quant-agent/chat/sessions", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const json = (await res.json()) as { sessions?: AgentChatSession[] };
      setSessions(json.sessions ?? []);
    } catch {
      setSessions((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const loadMessages = useCallback(async (chatId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/quant-agent/chat/sessions/${encodeURIComponent(chatId)}/messages`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("failed");
      const json = (await res.json()) as { messages?: AgentChatMessageRecord[] };
      setMessages((json.messages ?? []).map(toDisplayMessage));
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function handleSelectChat(chatId: string) {
    setActiveChatId(chatId);
    void loadMessages(chatId);
    const session = (sessions ?? []).find((s) => s.id === chatId);
    if (session?.symbol) setSymbol(session.symbol);
  }

  function handleNewChat() {
    setActiveChatId(null);
    setMessages([]);
    setSymbol(DEFAULT_QUANT_AGENT_SYMBOL);
  }

  async function handleDeleteChat(chatId: string) {
    try {
      await fetch(`/api/quant-agent/chat/sessions/${encodeURIComponent(chatId)}`, { method: "DELETE" });
    } catch {
      /* best-effort — the list refresh below reconciles either way */
    }
    if (chatId === activeChatId) {
      setActiveChatId(null);
      setMessages([]);
    }
    setSessions((prev) => (prev ?? []).filter((s) => s.id !== chatId));
  }

  async function ensureChatId(): Promise<string> {
    if (activeChatId) return activeChatId;
    const res = await fetch("/api/quant-agent/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: locale }),
    });
    if (!res.ok) throw new Error("could not create chat session");
    const json = (await res.json()) as { session: AgentChatSession };
    setActiveChatId(json.session.id);
    setSessions((prev) => [json.session, ...(prev ?? [])]);
    return json.session.id;
  }

  async function handleSend(text: string) {
    setSending(true);
    const userMessage: QuantAgentChatMessageData = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const pendingId = `local-assistant-${Date.now()}`;
    setMessages((prev) => [...prev, userMessage, { id: pendingId, role: "assistant", content: "", pending: true }]);

    try {
      const chatId = await ensureChatId();
      const res = await fetch("/api/quant-agent/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message: text, locale, symbol }),
      });
      if (!res.ok || !res.body) throw new Error("stream request failed");

      await consumeSse<QuantAgentChatTurnResult>(res, {
        onDelta: (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === pendingId ? { ...m, content: delta, pending: true } : m)),
          );
        },
        onDone: (payload) => {
          if (!payload) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingId
                ? {
                    id: pendingId,
                    role: "assistant",
                    content: payload.reply,
                    pending: false,
                    usedSkills: payload.usedSkills,
                    strategyProposal: payload.strategyProposal,
                    memoryCandidate: payload.memoryCandidate,
                    recommendations: payload.recommendations,
                    createdAt: Date.now(),
                  }
                : m,
            ),
          );
        },
        onError: (message) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === pendingId ? { ...m, content: message, pending: false } : m)),
          );
        },
      });
      void loadSessions();
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === pendingId ? { ...m, content: t("qa.chat.error"), pending: false } : m)),
      );
    } finally {
      setSending(false);
    }
  }

  const showEmptyState = !loadingMessages && messages.length === 0;

  return (
    <div dir={dir} className="grid h-[calc(100dvh-13rem)] min-h-[28rem] grid-cols-1 gap-3 md:grid-cols-[16rem_1fr]">
      <div className="hidden min-h-0 md:block">
        <QuantAgentChatSidebar
          sessions={sessions ?? []}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={(id) => void handleDeleteChat(id)}
        />
      </div>

      <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">{t("qa.chat.header.title")}</span>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {loadingMessages ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            </div>
          ) : showEmptyState ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-10 text-center">
              <EmptyState
                icon={<Sparkles aria-hidden="true" />}
                title={t("qa.chat.empty.title")}
                description={t("qa.chat.empty.description")}
              />
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_START_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void handleSend(t(`${key}.prompt`))}
                    className="min-h-11 rounded-full border border-border bg-background px-3.5 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
                  >
                    {t(`${key}.label`)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <QuantAgentChatMessage key={message.id} message={message} chatId={activeChatId ?? undefined} />
            ))
          )}
        </div>

        <div className="shrink-0 border-t border-border p-2">
          <QuantAgentChatComposer
            onSend={(text) => void handleSend(text)}
            disabled={sending}
            symbol={symbol}
            brokerConnected={false}
            onSymbolChange={setSymbol}
          />
        </div>
      </div>
    </div>
  );
}
