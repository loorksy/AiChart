"use client";

/**
 * Quant Agent Chat panel (plan §4) — the center chat surface: header,
 * scrollable message list with an empty-state welcome screen offering a few
 * quick-start prompts, composer fixed at the bottom. Combined with
 * `QuantAgentChatSidebar` and `QuantAgentRightRail` (Watchlist + AI Scheduled
 * Monitors, plan "Feature A" §A7) in a three-column grid — the right rail is
 * hidden below `lg` rather than dropped, since it is optional context, not a
 * primary surface.
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
import type { QuantAnalysisRecord } from "@/lib/quantAgent/types";
import {
  resolveQuantAgentQuickToolDispatch,
  type QuantAgentQuickTool,
} from "@/lib/agent/quantAgentChat/quickTools";
import { QuantAgentChatComposer } from "./QuantAgentChatComposer";
import { QuantAgentChatSidebar } from "./QuantAgentChatSidebar";
import { QuantAgentChatMessage, type QuantAgentChatMessageData } from "./QuantAgentChatMessage";
import { QuantAgentRightRail } from "@/components/quantAgent/QuantAgentRightRail";
import { QuantAgentComposerCoach } from "./QuantAgentComposerCoach";
import { QuantAgentQuickTools } from "./QuantAgentQuickTools";
import { QuantAgentQuickToolsSheet } from "./QuantAgentQuickToolsSheet";
import { QuantAnalysisCard } from "@/components/quantAgent/analysis/QuantAnalysisCard";

/** Mirrors the exact case-insensitive/trimmed matching style `pendingTask.ts` uses server-side. */
const CANCEL_KEYWORD_BY_LOCALE: Record<"ar" | "en", string> = { ar: "إلغاء", en: "cancel" };

/** Matches Lonora's own chat: a concrete active symbol, never an unset one. */
const DEFAULT_QUANT_AGENT_SYMBOL = "EURUSD";
/** Same default Lonora's own composer/monitors use for a fresh timeframe (plan §4/§5's new interval concept). */
const DEFAULT_QUANT_AGENT_INTERVAL = "1h";

interface StoredMessageResult {
  usedSkills?: QuantAgentChatMessageData["usedSkills"];
  strategyProposal?: QuantAgentChatMessageData["strategyProposal"];
  memoryCandidate?: QuantAgentChatMessageData["memoryCandidate"];
  recommendations?: QuantAgentChatMessageData["recommendations"];
  composerCoach?: QuantAgentChatMessageData["composerCoach"];
  /** Quick Tools (Wave 2) — the stored analyses a "Diagnose symbol"/radar turn produced. */
  analyses?: QuantAnalysisRecord[];
}

/**
 * `QuantAgentChatMessageData` plus the analyses a Quick Tool turn attaches.
 * Kept local because the bubble component does not render them itself yet —
 * see the message list below, which renders the card under the bubble.
 */
type QuantAgentPanelMessage = QuantAgentChatMessageData & { analyses?: QuantAnalysisRecord[] };

/** The turn payload, plus the two fields the orchestrator adds for a Quick Tool turn. */
type QuantAgentChatTurnPayload = QuantAgentChatTurnResult & { analyses?: QuantAnalysisRecord[] };

function toDisplayMessage(record: AgentChatMessageRecord): QuantAgentPanelMessage {
  const result = record.result as StoredMessageResult | undefined;
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    usedSkills: result?.usedSkills,
    strategyProposal: result?.strategyProposal ?? null,
    memoryCandidate: result?.memoryCandidate ?? null,
    recommendations: result?.recommendations,
    composerCoach: result?.composerCoach ?? null,
    analyses: result?.analyses,
    createdAt: record.createdAt,
  };
}

export function QuantAgentChatPanel() {
  const { t, dir, locale } = useLocale();
  const [sessions, setSessions] = useState<AgentChatSession[] | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<QuantAgentPanelMessage[]>([]);
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
  /**
   * The timeframe the next backtest is scoped to (plan §4/§5) — lifted next
   * to `symbol` exactly the same way, so both the composer's NEW
   * `ComposerIntervalPicker` and the outgoing request body read the same
   * value. Named `setChatInterval` (not `setInterval`) to avoid shadowing
   * the global timer function of the same name.
   */
  const [interval, setChatInterval] = useState(DEFAULT_QUANT_AGENT_INTERVAL);
  /** Composer draft text (Feature B) — lifted so a Composer Coach suggestion chip can set it. */
  const [draftText, setDraftText] = useState("");
  /** Quick Tools (Wave 2) — the composer's sheet; the welcome grid needs no state. */
  const [quickToolsOpen, setQuickToolsOpen] = useState(false);
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
    setDraftText("");
    const session = (sessions ?? []).find((s) => s.id === chatId);
    if (session?.symbol) setSymbol(session.symbol);
    setChatInterval(session?.interval || DEFAULT_QUANT_AGENT_INTERVAL);
  }

  function handleNewChat() {
    setActiveChatId(null);
    setMessages([]);
    setSymbol(DEFAULT_QUANT_AGENT_SYMBOL);
    setChatInterval(DEFAULT_QUANT_AGENT_INTERVAL);
    setDraftText("");
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
    const userMessage: QuantAgentPanelMessage = {
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
        body: JSON.stringify({ chatId, message: text, locale, symbol, interval }),
      });
      if (!res.ok || !res.body) throw new Error("stream request failed");

      await consumeSse<QuantAgentChatTurnPayload>(res, {
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
                    composerCoach: payload.composerCoach,
                    analyses: payload.analyses,
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

  /**
   * Quick Tools (Wave 2). Six tools only fill the draft — the user still reads,
   * edits and sends it themselves. The two engine tools ("Diagnose symbol" and
   * "Opportunity radar") send their own command, which the orchestrator
   * recognises and answers by running the analysis engine instead of the chat
   * LLM. An unavailable tool never gets here: its tile is disabled.
   */
  function handleQuickTool(tool: QuantAgentQuickTool) {
    const dispatch = resolveQuantAgentQuickToolDispatch(tool, { locale, symbol });
    if (dispatch.kind === "send") {
      void handleSend(dispatch.text);
      return;
    }
    if (dispatch.kind === "draft") {
      setDraftText(dispatch.text);
    }
  }

  const showEmptyState = !loadingMessages && messages.length === 0;
  /**
   * Composer Coach (Feature B) — conditional on the LATEST assistant message
   * carrying a `composerCoach` payload, so it disappears the moment step 4 is
   * confirmed (that turn's `composerCoach` is `null`) or the wizard is
   * cancelled. Survives a page reload because `toDisplayMessage` restores it
   * from the persisted `result` JSON.
   */
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant" && !m.pending);
  const activeComposerCoach = lastAssistantMessage?.composerCoach ?? null;

  return (
    <div
      dir={dir}
      className="grid h-[calc(100dvh-13rem)] min-h-[28rem] grid-cols-1 gap-3 md:grid-cols-[16rem_1fr] lg:grid-cols-[16rem_1fr_18rem]"
    >
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
            <div className="flex flex-col items-center gap-4 px-1 py-6 text-center">
              <EmptyState
                icon={<Sparkles aria-hidden="true" />}
                title={t("qa.chat.empty.title")}
                description={t("qa.chat.empty.description")}
              />
              {/* The welcome grid — the same eight tools the composer's sheet
                  offers once the conversation has started. */}
              <QuantAgentQuickTools
                onSelect={handleQuickTool}
                disabled={sending}
                className="w-full max-w-2xl text-start"
              />
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id}>
                <QuantAgentChatMessage message={message} chatId={activeChatId ?? undefined} />
                {/* Quick Tools' analyses. They sit directly under the bubble
                    rather than inside it because the bubble's own data shape
                    carries no analysis slot yet; the width matches an assistant
                    bubble so the two read as one turn. */}
                {message.analyses?.length ? (
                  <div className="me-auto max-w-[min(95%,46rem)] space-y-2 px-1">
                    {message.analyses.map((analysis) => (
                      <QuantAnalysisCard key={analysis.id} analysis={analysis} />
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="shrink-0 border-t border-border p-2">
          {activeComposerCoach ? (
            <QuantAgentComposerCoach
              coach={activeComposerCoach}
              disabled={sending}
              onSuggestionClick={(value) => setDraftText(value)}
              onCancel={() => void handleSend(CANCEL_KEYWORD_BY_LOCALE[locale])}
            />
          ) : null}
          <QuantAgentChatComposer
            onSend={(text) => void handleSend(text)}
            disabled={sending}
            symbol={symbol}
            interval={interval}
            brokerConnected={false}
            onSymbolChange={setSymbol}
            onIntervalChange={setChatInterval}
            value={draftText}
            onValueChange={setDraftText}
            // Hidden on the welcome screen, where the grid is already on show.
            onOpenQuickTools={messages.length ? () => setQuickToolsOpen(true) : undefined}
          />
        </div>
      </div>

      <QuantAgentQuickToolsSheet
        open={quickToolsOpen}
        onClose={() => setQuickToolsOpen(false)}
        onSelect={handleQuickTool}
        disabled={sending}
      />

      <div className="hidden min-h-0 lg:block">
        <QuantAgentRightRail activeSymbol={symbol} />
      </div>
    </div>
  );
}
