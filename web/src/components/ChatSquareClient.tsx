"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { LineChart, X, History, BarChart2 } from "lucide-react";
import {
  DEFAULT_SELECTIONS,
  type ChatStartSelections,
} from "@/components/chat/ChatModeBar";
import { ChatSidebar } from "@/components/chat/square/chat-sidebar";
import { AnalysisLogDrawer } from "@/components/chat/square/analysis-log-drawer";
import { ChatConversation } from "@/components/chat/square/chat-conversation";
import { ChatInputBar, type Attachment } from "@/components/chat/square/chat-input-bar";
import { ChartPreviewPanel } from "@/components/ui/chart-preview-panel";
import { useChatStore } from "@/stores/chat-store";
import { useAgentActivities } from "@/hooks/useAgentActivities";
import type { ChartHydrateSnapshot } from "@/hooks/useChartAnalysis";
import { useMe } from "@/hooks/useMe";
import { needsAgentActivity } from "@/lib/agentActivity";
import { emitSseConnect, markSseConnected } from "@/lib/agentActivityPipeline";
import { overlaysFromRecommendation } from "@/lib/chartOverlays";
import type { ChartAnalysisLogEntry } from "@/lib/conversations";
import {
  fileToChatImage,
  imageDataUrl,
  type ChatImagePayload,
} from "@/lib/chatImage";
import { consumeSse } from "@/lib/sse";
import type { ProcessedIntent } from "@/lib/tradeFlow";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/LocaleProvider";

function extractSymbol(text: string): string | null {
  const crypto = text.match(/\b([A-Z]{2,10}USDT)\b/i);
  if (crypto) return crypto[1].toUpperCase();
  return null;
}

export default function ChatSquareClient({
  agentReady: agentReadyInitial,
  onCreditsUsed,
}: {
  agentReady: boolean;
  onCreditsUsed?: () => void;
}) {
  const { t, locale } = useLocale();
  const [agentReady, setAgentReady] = useState(agentReadyInitial);
  const [model, setModel] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<ChatImagePayload | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(
    null,
  );
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chartAnalyzing, setChartAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSymbol, setPreviewSymbol] = useState("BTCUSDT");
  const [previewInterval, setPreviewInterval] = useState("1h");
  const [previewWidth, setPreviewWidth] = useState(440);
  const chartStreamRef = useRef("");
  const streamBufferRef = useRef("");
  const streamFlushTimerRef = useRef<number | null>(null);

  // Drag-to-resize the chart panel. Direction-aware (RTL/LTR) with expanded limits.
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = previewWidth;
    const isRtl = document.documentElement.dir === "rtl" || locale === "ar";
    const onMove = (ev: MouseEvent) => {
      const deltaX = isRtl ? (ev.clientX - startX) : (startX - ev.clientX);
      const maxW = Math.min(1200, Math.floor(window.innerWidth * 0.75));
      const minW = 280;
      const next = Math.min(maxW, Math.max(minW, startW + deltaX));
      setPreviewWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  const [busyIntentId, setBusyIntentId] = useState<number | null>(null);
  const [executingIntentId, setExecutingIntentId] = useState<number | null>(
    null,
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const handleAddAttachment = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setError(locale === "ar" ? "حجم الملف يتجاوز الحد الأقصى (5 ميجابايت)." : "File size exceeds limit (5MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setAttachments((prev) => [
        ...prev,
        {
          name: file.name,
          size: file.size,
          type: file.type,
          content: content || "",
        },
      ]);
    };
    reader.readAsText(file);
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleWidgetAction = (actionType: string, payload: any) => {
    if (actionType === "execute_trade") {
      const id = Number(payload.intentId);
      const msg = messages.find((m) => m.intents?.some((i) => i.id === id));
      if (msg) void actOnIntent(msg.id, id, "approve");
    } else if (actionType === "reject_trade") {
      const id = Number(payload.intentId);
      const msg = messages.find((m) => m.intents?.some((i) => i.id === id));
      if (msg) void actOnIntent(msg.id, id, "reject");
    } else if (actionType === "submit_prompt") {
      const text = String(payload.text);
      void send(text);
    } else if (actionType === "inject_input") {
      const text = String(payload.text);
      setInput(text);
    }
  };

  // Session-mode selections (applied on the first message of a session).
  const [sel, setSel] = useState<ChatStartSelections>(DEFAULT_SELECTIONS);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [analysesOpen, setAnalysesOpen] = useState(false);
  const [analysesLog, setAnalysesLog] = useState<ChartAnalysisLogEntry[]>([]);
  const [analysesLoading, setAnalysesLoading] = useState(false);
  const [chartHydrateOverride, setChartHydrateOverride] =
    useState<ChartHydrateSnapshot | null>(null);

  const { data: me, refresh: refreshMe } = useMe();

  const {
    conversations,
    selectedId,
    selectedSlug,
    messages,
    fetchConversations,
    createNew,
    selectConversation,
    appendMessage,
    updateLastAssistant,
    setMessages,
    resetSelection,
  } = useChatStore();

  const { activities, reset: resetActivities, upsert: upsertActivityRaw } =
    useAgentActivities();

  const upsertActivity = useCallback(
    (activity: Parameters<typeof upsertActivityRaw>[0]) => {
      if (activity.id !== "sse-connect") {
        markSseConnected(upsertActivityRaw);
      }
      upsertActivityRaw(activity);
    },
    [upsertActivityRaw],
  );

  const hasConversation = messages.length > 0 || selectedId !== null;
  const displayName = me?.displayName ?? (locale === "ar" ? "متداول" : "Trader");

  const chartHydrateFromMessages = useMemo((): ChartHydrateSnapshot | null => {
    if (chartAnalyzing || busy) return null;
    const withDrawings = messages.filter(
      (m) => (m.chartAnalyze?.drawings?.length ?? 0) > 0,
    );
    const match =
      [...withDrawings]
        .reverse()
        .find(
          (m) =>
            m.chartAnalyze?.symbol?.toUpperCase() === previewSymbol.toUpperCase() &&
            (m.chartAnalyze?.interval ?? "1h") === previewInterval,
        ) ?? [...withDrawings].reverse()[0];
    if (!match?.chartAnalyze) return null;
    const meta = match.chartAnalyze;
    const rec = meta.recommendation as Recommendation | null | undefined;
    return {
      drawings: meta.drawings,
      overlays:
        meta.overlays && meta.overlays.length > 0
          ? meta.overlays
          : rec
            ? overlaysFromRecommendation(rec)
            : undefined,
      recommendation: rec ?? null,
    };
  }, [messages, previewSymbol, previewInterval, chartAnalyzing, busy]);

  const chartHydrate = chartHydrateOverride ?? chartHydrateFromMessages;

  useEffect(() => {
    if (!analysesOpen || !selectedSlug) return;
    setAnalysesLoading(true);
    void fetch(`/api/conversations/${encodeURIComponent(selectedSlug)}/analyses`)
      .then((r) => r.json())
      .then((d) => setAnalysesLog((d as { analyses?: ChartAnalysisLogEntry[] }).analyses ?? []))
      .catch(() => setAnalysesLog([]))
      .finally(() => setAnalysesLoading(false));
  }, [analysesOpen, selectedSlug]);

  function loadAnalysisFromLog(entry: ChartAnalysisLogEntry) {
    setPreviewSymbol(entry.symbol.toUpperCase());
    setPreviewInterval(entry.interval);
    setPreviewOpen(true);
    setChartHydrateOverride({
      drawings: entry.drawings as ChartHydrateSnapshot["drawings"],
      overlays: entry.overlays as ChartHydrateSnapshot["overlays"],
      recommendation: (entry.recommendation as Recommendation | null) ?? null,
    });
    setAnalysesOpen(false);
    requestAnimationFrame(() => {
      document
        .getElementById(`chat-msg-${entry.messageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  useEffect(() => {
    void fetchConversations();
    void fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { settings?: { mode?: string; active_market?: string; trading_style?: string } } | null) => {
        const s = data?.settings;
        if (!s) return;
        setSel((prev) => ({
          ...prev,
          ...(s.mode === "auto" || s.mode === "approval" || s.mode === "direct"
            ? { mode: s.mode }
            : {}),
          market: "forex",
          ...(s.trading_style === "scalp" ||
          s.trading_style === "day" ||
          s.trading_style === "swing" ||
          s.trading_style === "position"
            ? { trading_style: s.trading_style }
            : {}),
        }));
      })
      .catch(() => undefined);
    void fetch("/api/chat/status")
      .then((r) => r.json())
      .then((d: { ready?: boolean; model?: string | null }) => {
        setAgentReady(Boolean(d.ready));
        setModel(d.model ?? null);
      })
      .catch(() => undefined);
  }, [fetchConversations]);

  // Restore the conversation from the URL (?c=<slug>) on first load so each chat
  // is a shareable, refresh-safe route backed by the server. The id is an opaque
  // slug (not enumerable); a legacy numeric id still resolves server-side.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const c = new URLSearchParams(window.location.search).get("c");
    if (c && c.trim()) void selectConversation(c.trim());
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL in sync with the selected conversation (no history spam).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = selectedSlug
      ? `/chat?c=${encodeURIComponent(selectedSlug)}`
      : "/chat";
    if (window.location.pathname + window.location.search !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [selectedSlug]);

  useEffect(() => {
    const pending = sessionStorage.getItem("aichart_pending_prompt");
    if (!pending) return;
    sessionStorage.removeItem("aichart_pending_prompt");
    void send(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase B: Automatically open the chart preview panel when a conversation exists
  useEffect(() => {
    if (hasConversation) {
      const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
      if (!isMobile && !busy && !chartAnalyzing) setPreviewOpen(true);
    } else {
      setPreviewOpen(false);
    }
  }, [hasConversation, busy, chartAnalyzing]);

  // Keep chat chart symbol aligned with composer market/symbol selection.
  useEffect(() => {
    if (sel.symbol) {
      setPreviewSymbol(sel.symbol.toUpperCase());
      return;
    }
    setPreviewSymbol("EURUSD");
  }, [sel.symbol]);

  async function handleImageSelect(file: File) {
    setImageError(null);
    const result = await fileToChatImage(file);
    if (!result.ok) {
      setImageError(result.error);
      return;
    }
    setPendingImage(result.image);
    setPendingImagePreview(imageDataUrl(result.image));
  }

  function clearPendingImage() {
    setPendingImage(null);
    setPendingImagePreview(null);
    setImageError(null);
  }

  function patchMessageIntents(
    messageId: string,
    intentId: number,
    patch: Partial<ProcessedIntent>,
  ) {
    setMessages(
      useChatStore.getState().messages.map((m) => {
        if (m.id !== messageId || !m.intents) return m;
        return {
          ...m,
          intents: m.intents.map((i) =>
            i.id === intentId ? { ...i, ...patch } : i,
          ),
        };
      }),
    );
  }

  async function actOnIntent(
    messageId: string,
    intentId: number,
    action: "approve" | "reject",
  ) {
    setBusyIntentId(intentId);
    const isApprove = action === "approve";
    if (isApprove) {
      setExecutingIntentId(intentId);
      setShowActivity(true);
      resetActivities();
      emitSseConnect(upsertActivityRaw);
    }
    try {
      const res = await fetch(`/api/trades/intents/${intentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, stream: isApprove }),
      });

      if (isApprove) {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(
            (locale === "ar" ? "لم تُنفّذ: " : "Failed exit: ") +
              ((data as { reason?: string; error?: string }).reason ??
                (data as { error?: string }).error ??
                "Unknown reason"),
          );
        } else {
          const data = await consumeSse<{ ok: boolean; reason?: string }>(res, {
            onActivity: upsertActivity,
            onError: (msg) => setError(msg),
          });
          if (data && !data.ok) {
            setError((locale === "ar" ? "لم تُنفّذ: " : "Failed exit: ") + (data.reason ?? "Unknown reason"));
          }
          patchMessageIntents(messageId, intentId, {
            status: data?.ok ? "executed" : "failed",
            reason: data?.reason,
          });
        }
      } else if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? (locale === "ar" ? "تعذّر رفض الطلب." : "Could not reject request."));
      } else {
        patchMessageIntents(messageId, intentId, { status: "rejected" });
      }
    } catch {
      setError(locale === "ar" ? "تعذّر معالجة الطلب." : "Could not process request.");
    } finally {
      setBusyIntentId(null);
      setExecutingIntentId(null);
      setShowActivity(false);
    }
  }

  async function send(text: string, image?: ChatImagePayload | null) {
    const content = text.trim();
    const attach = image ?? pendingImage;
    if ((!content && !attach && attachments.length === 0) || busy || chartAnalyzing) return;
    setError(null);

    const sym = extractSymbol(content);
    if (sym) {
      setPreviewSymbol(sym);
      setPreviewOpen(true);
    }

    let convId = selectedId;
    if (!convId) convId = await createNew();

    const displayText =
      content || (attach ? (locale === "ar" ? "حلّل الشارت المرفق وأعطني توصية." : "Analyze the attached chart and recommend.") : "");

    appendMessage({
      id: `u-${Date.now()}`,
      role: "user",
      content: displayText,
      imageUrl: attach ? imageDataUrl(attach) : undefined,
    });
    setInput("");
    clearPendingImage();
    
    // Clear and save files
    const currentAttachments = [...attachments];
    setAttachments([]);

    const assistantId = `a-${Date.now()}`;
    appendMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
    });

    const trackActivity = needsAgentActivity(content || displayText);
    setShowActivity(trackActivity);
    resetActivities();
    if (trackActivity) emitSseConnect(upsertActivityRaw);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content || undefined,
          image: attach
            ? { media_type: attach.media_type, data: attach.data }
            : undefined,
          attachments: currentAttachments.map((att) => ({
            name: att.name,
            type: att.type,
            content: att.content,
          })),
          conversationId: convId,
          stream: true,
          session_context: {
            trading_style: sel.trading_style,
            mode: sel.mode,
            active_market: "forex",
            response_mode: sel.response_mode,
            symbol: sel.symbol || undefined,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? (locale === "ar" ? "حدث خطأ." : "An error occurred."));
        setMessages(
          useChatStore.getState().messages.filter((m) => m.id !== assistantId),
        );
        return;
      }

      let streamError: string | null = null;
      let streamed = "";
      const flushStream = (force = false) => {
        if (!force && streamFlushTimerRef.current != null) return;
        const run = () => {
          streamFlushTimerRef.current = null;
          updateLastAssistant({ content: streamBufferRef.current, streaming: true });
        };
        if (force) run();
        else streamFlushTimerRef.current = window.setTimeout(run, 80);
      };

      const data = await consumeSse<{
        reply: string;
        recommendations?: Recommendation[];
        intents?: ProcessedIntent[];
        question?: any;
        ui_schema?: any;
      }>(res, {
        onActivity: upsertActivity,
        onDelta: (t) => {
          streamed += t;
          streamBufferRef.current = streamed;
          flushStream();
        },
        onError: (msg) => {
          streamError = msg;
          setError(msg);
        },
      });
      flushStream(true);

      if (!data) {
        if (!streamError) setError(locale === "ar" ? "لم يصل رد من الوكيل." : "No response from agent.");
        updateLastAssistant({ streaming: false });
        return;
      }

      const recs = data.recommendations;
      if (recs?.length) {
        setPreviewSymbol(recs[0].symbol);
        setPreviewOpen(true);
      }

      const pendingIntents =
        data.intents?.filter((i) => i.status === "pending") ?? [];

      updateLastAssistant({
        content: data.reply || streamed,
        streaming: false,
        recommendations: recs,
        intents: pendingIntents.length ? pendingIntents : undefined,
        question: data.question || null,
        ui_schema: data.ui_schema || null,
      });

      void fetchConversations();
      void refreshMe();
      onCreditsUsed?.();
    } catch {
      setError(locale === "ar" ? "تعذّر الاتصال بالخادم." : "Failed to connect to server.");
    } finally {
      if (streamFlushTimerRef.current != null) {
        window.clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      streamBufferRef.current = "";
      setBusy(false);
      setShowActivity(false);
    }
  }

  const allRecommendations = messages.flatMap(
    (m) => (m.recommendations as Recommendation[] | undefined) ?? [],
  );

  useEffect(() => {
    if (sel.symbol) setPreviewSymbol(sel.symbol.toUpperCase());
  }, [sel.symbol]);

  const handleChartAnalyzeStart = useCallback(async () => {
    chartStreamRef.current = "";
    setError(null);
    setChartHydrateOverride(null);
    setShowActivity(true);
    resetActivities();
    emitSseConnect(upsertActivityRaw);
    setChartAnalyzing(true);
    let convId = selectedId;
    if (!convId) convId = await createNew();
    appendMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: `تحليل ${previewSymbol} · ${previewInterval}`,
    });
    appendMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      streaming: true,
    });
  }, [
    selectedId,
    previewSymbol,
    previewInterval,
    createNew,
    appendMessage,
    resetActivities,
    upsertActivityRaw,
  ]);

  const handleChartStreamDelta = useCallback(
    (text: string) => {
      chartStreamRef.current += text;
      updateLastAssistant({
        content: chartStreamRef.current,
        streaming: true,
      });
    },
    [updateLastAssistant],
  );

  const handleChartAnalyzeDone = useCallback(
    (payload: {
      reply: string;
      recommendation?: Recommendation | null;
      intents?: ProcessedIntent[];
    }) => {
      const recs = payload.recommendation ? [payload.recommendation] : undefined;
      const pendingIntents =
        payload.intents?.filter((i) => i.status === "pending") ?? [];
      updateLastAssistant({
        content: payload.reply,
        streaming: false,
        recommendations: recs,
        intents: pendingIntents.length ? pendingIntents : undefined,
      });
      if (payload.recommendation) {
        setPreviewSymbol(payload.recommendation.symbol);
        setPreviewOpen(true);
      }
      setChartAnalyzing(false);
      setShowActivity(false);
      void fetchConversations();
      void refreshMe();
      onCreditsUsed?.();
    },
    [
      updateLastAssistant,
      fetchConversations,
      refreshMe,
      onCreditsUsed,
    ],
  );

  const handleChartAnalyzeError = useCallback(
    (message: string) => {
      updateLastAssistant({
        content: message || (locale === "ar" ? "تعذّر إكمال التحليل." : "Analysis failed."),
        streaming: false,
      });
      setChartAnalyzing(false);
      setShowActivity(false);
    },
    [updateLastAssistant, locale],
  );

  const handleRequestChatMessage = useCallback(
    (text: string) => {
      void send(text);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, selectedId],
  );

  const chartPanelProps = {
    symbol: previewSymbol,
    interval: previewInterval,
    onIntervalChange: setPreviewInterval,
    onSymbolChange: (s: string) => {
      const sym = s.toUpperCase();
      setPreviewSymbol(sym);
      setSel((prev) => ({ ...prev, symbol: sym }));
    },
    market: "forex" as const,
    recommendations: allRecommendations,
    conversationId: selectedId,
    onCreditsUsed,
    onAnalyzeStart: () => void handleChartAnalyzeStart(),
    onStreamDelta: handleChartStreamDelta,
    onAnalyzeDone: handleChartAnalyzeDone,
    onAnalyzeError: handleChartAnalyzeError,
    onActivity: upsertActivity,
    onRequestChatMessage: handleRequestChatMessage,
    hydrateSnapshot: chartHydrate,
  };

  const conversationBusy = busy || chartAnalyzing;

  const inputPlaceholder = hasConversation
    ? t("chat.placeholder_followup")
    : t("chat.placeholder");

  // Fresh chat (no messages yet) → Phase A (Welcoming State).
  const isEmpty = messages.length === 0 && !conversationBusy;

  return (
    <div className="flex h-dvh min-h-0 flex-1 flex-col overflow-hidden bg-background lg:h-full">
      {/* Sleek Top Header Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0c0c0e]/60 px-4 backdrop-blur-md ps-16 lg:ps-6">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse shrink-0" />
          <h2 className="text-sm font-semibold truncate text-zinc-200">
            {selectedId
              ? (conversations.find((c) => c.id === selectedId)?.title ?? (locale === "ar" ? "وكيل التداول" : "Trading Agent"))
              : (locale === "ar" ? "محادثة جديدة" : "New Chat")}
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          {/* New Chat Button */}
          <button
            type="button"
            onClick={() => {
              resetSelection();
              void createNew();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800 hover:text-foreground active:scale-95 duration-100 cursor-pointer"
            title={locale === "ar" ? "محادثة جديدة" : "New Chat"}
          >
            <span className="hidden sm:inline">{locale === "ar" ? "محادثة جديدة" : "New Chat"}</span>
            <span className="sm:hidden">{locale === "ar" ? "جديد" : "New"}</span>
          </button>

          <button
            type="button"
            onClick={() => setAnalysesOpen(true)}
            disabled={!selectedSlug}
            className={cn(
              "rounded-lg border p-1.5 text-zinc-400 transition active:scale-95 duration-100 cursor-pointer disabled:opacity-40",
              analysesOpen
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-white/[0.06] bg-zinc-900/60 hover:bg-zinc-800 hover:text-foreground",
            )}
            title={locale === "ar" ? "سجل التحليلات" : "Analysis log"}
          >
            <BarChart2 className="h-4 w-4" />
          </button>

          {/* Chat History Toggle Button */}
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className={cn(
              "rounded-lg border p-1.5 text-zinc-400 transition active:scale-95 duration-100 cursor-pointer",
              historyOpen
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-white/[0.06] bg-zinc-900/60 hover:bg-zinc-800 hover:text-foreground",
            )}
            title={locale === "ar" ? "سجل المحادثات" : "Conversation History"}
          >
            <History className="h-4 w-4" />
          </button>

          {/* Chart Preview Toggle Button */}
          <button
            type="button"
            onClick={() => setPreviewOpen((p) => !p)}
            className={cn(
              "rounded-lg border p-1.5 text-zinc-400 transition active:scale-95 duration-100 cursor-pointer",
              previewOpen
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-white/[0.06] bg-zinc-900/60 hover:bg-zinc-800 hover:text-foreground",
            )}
            title={locale === "ar" ? "معاينة الشارت" : "Chart Preview"}
          >
            <LineChart className="h-4 w-4" />
          </button>
        </div>
      </header>

      {!agentReady && (
        <p className="shrink-0 border-b border-border bg-card/85 px-4 py-2 text-xs text-muted-foreground transition duration-200">
          {t("chat.no_agent_key")}
        </p>
      )}
      {error && (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive font-medium transition duration-200">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          
          {/* Two-State Condition */}
          {isEmpty ? (
            /* Phase A: Welcoming Mode (Initial State) */
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center max-w-2xl mx-auto w-full px-4 gap-6 text-center animate-in fade-in duration-300">
              <div className="rounded-2xl bg-gradient-to-tr from-primary/20 to-primary/5 p-3.5 ring-1 ring-primary/20 shadow-md">
                <Image src="/logo.png" alt="AiChart" width={48} height={48} className="rounded-xl object-contain" />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {t("welcome.title", { name: displayName })}
                </h1>
                <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                  {t("welcome.subtitle")}
                </p>
              </div>
            </div>
          ) : (
            /* Phase B: Operational Mode (Active State) */
            <ChatConversation
              messages={messages}
              busy={conversationBusy}
              showActivity={showActivity || executingIntentId !== null}
              activities={activities}
              executionMode={sel.mode}
              onPreview={() => setPreviewOpen(true)}
              busyIntentId={busyIntentId}
              onIntentApprove={(id) => {
                const msg = messages.find((m) =>
                  m.intents?.some((i) => i.id === id),
                );
                if (msg) void actOnIntent(msg.id, id, "approve");
              }}
              onIntentReject={(id) => {
                const msg = messages.find((m) =>
                  m.intents?.some((i) => i.id === id),
                );
                if (msg) void actOnIntent(msg.id, id, "reject");
              }}
              onQuestionSelect={(val) => {
                void send(val);
              }}
              onWidgetAction={handleWidgetAction}
            />
          )}

          {/* Chat Input Bar */}
          <ChatInputBar
            value={input}
            onChange={setInput}
            onSend={() => void send(input, pendingImage)}
            pendingImage={pendingImage}
            pendingImagePreview={pendingImagePreview}
            onImageSelect={(file) => void handleImageSelect(file)}
            onImageClear={clearPendingImage}
            imageError={imageError}
            attachments={attachments}
            onAddAttachment={handleAddAttachment}
            onRemoveAttachment={handleRemoveAttachment}
            disabled={conversationBusy || busyIntentId != null}
            busy={conversationBusy}
            placeholder={inputPlaceholder}
            centered={false}
            selections={sel}
            onSelectionsChange={setSel}
          />
        </div>

        {/* Phase B: Live Chart Slide-out Sidebar Panel */}
        {previewOpen && (
          <>
            {/* Drag handle to resize the chart */}
            <div
              onMouseDown={startResize}
              className="hidden w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 md:block"
              role="separator"
              aria-label={t("chat.resize_chart")}
            />
            <aside
              style={{ width: previewWidth }}
              className="hidden h-full min-h-0 shrink-0 flex-col overflow-hidden border-s border-border bg-card md:flex shadow-lg"
            >
              <ChartPreviewPanel
                {...chartPanelProps}
                onClose={() => setPreviewOpen(false)}
                className="h-full min-h-0 border-0"
              />
            </aside>
          </>
        )}
      </div>

      {/* Mobile view full-screen chart panel override */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
            <span className="text-sm font-semibold">{t("chat.chart_preview")}</span>
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="rounded-lg p-2 text-muted-foreground hover:bg-secondary transition"
              aria-label={t("chat.close_chart")}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChartPreviewPanel
              {...chartPanelProps}
              className="h-full border-0"
            />
          </div>
        </div>
      )}

      {/* Conversation history drawer — collapsed by default */}
      <ChatSidebar open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <AnalysisLogDrawer
        open={analysesOpen}
        onClose={() => setAnalysesOpen(false)}
        analyses={analysesLog}
        loading={analysesLoading}
        onSelect={loadAnalysisFromLog}
      />
    </div>
  );
}
