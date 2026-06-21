"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { LineChart, X, Search, Sparkles } from "lucide-react";
import {
  ChatModeBar,
  DEFAULT_SELECTIONS,
  type ChatStartSelections,
} from "@/components/chat/ChatModeBar";
import { ChatSidebar } from "@/components/chat/square/chat-sidebar";
import { ChatConversation } from "@/components/chat/square/chat-conversation";
import { ChatInputBar } from "@/components/chat/square/chat-input-bar";
import { ChartPreviewPanel } from "@/components/ui/chart-preview-panel";
import { useChatStore } from "@/stores/chat-store";
import { useAgentActivities } from "@/hooks/useAgentActivities";
import { useMe } from "@/hooks/useMe";
import { needsAgentActivity } from "@/lib/agentActivity";
import {
  fileToChatImage,
  imageDataUrl,
  type ChatImagePayload,
} from "@/lib/chatImage";
import { consumeSse } from "@/lib/sse";
import type { ProcessedIntent } from "@/lib/tradeFlow";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AgentActivityFeed } from "@/components/ui/agent-activity-feed";
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
  const [error, setError] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSymbol, setPreviewSymbol] = useState("BTCUSDT");
  const [previewInterval, setPreviewInterval] = useState("1h");
  const [previewWidth, setPreviewWidth] = useState(440);

  // Drag-to-resize the chart panel (RTL: panel on the left; dragging the
  // handle leftward widens it).
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = previewWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(760, Math.max(300, startW + (startX - ev.clientX)));
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
  // Session-mode selections (applied on the first message of a session).
  const [sel, setSel] = useState<ChatStartSelections>(DEFAULT_SELECTIONS);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: me, refresh: refreshMe } = useMe();

  const {
    selectedId,
    messages,
    fetchConversations,
    createNew,
    appendMessage,
    updateLastAssistant,
    setMessages,
    resetSelection,
  } = useChatStore();

  const {
    activities: intentActivities,
    reset: resetIntentActivities,
    upsert: upsertIntentActivity,
  } = useAgentActivities();
  const { activities, reset: resetActivities, upsert: upsertActivity } =
    useAgentActivities();

  const hasConversation = messages.length > 0 || selectedId !== null;
  const displayName = me?.displayName ?? (locale === "ar" ? "متداول" : "Trader");

  useEffect(() => {
    void fetchConversations();
    void fetch("/api/chat/status")
      .then((r) => r.json())
      .then((d: { ready?: boolean; model?: string | null }) => {
        setAgentReady(Boolean(d.ready));
        setModel(d.model ?? null);
      })
      .catch(() => undefined);
  }, [fetchConversations]);

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
      setPreviewOpen(true);
    } else {
      setPreviewOpen(false);
    }
  }, [hasConversation]);

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
      resetIntentActivities();
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
            onActivity: upsertIntentActivity,
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
      resetIntentActivities();
    }
  }

  async function send(text: string, image?: ChatImagePayload | null) {
    const content = text.trim();
    const attach = image ?? pendingImage;
    if ((!content && !attach) || busy) return;
    setError(null);
    const isFirstMessage = messages.length === 0;

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
          conversationId: convId,
          stream: true,
          start_context: isFirstMessage
            ? {
                trading_style: sel.trading_style,
                mode: sel.mode,
                active_market: sel.market,
                response_mode: sel.response_mode,
                symbol: sel.symbol || undefined,
              }
            : undefined,
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

      const data = await consumeSse<{
        reply: string;
        recommendations?: Recommendation[];
        intents?: ProcessedIntent[];
      }>(res, {
        onActivity: upsertActivity,
        onDelta: (t) => {
          streamed += t;
          updateLastAssistant({ content: streamed, streaming: true });
        },
        onError: (msg) => {
          streamError = msg;
          setError(msg);
        },
      });

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
      });

      void fetchConversations();
      void refreshMe();
      onCreditsUsed?.();
    } catch {
      setError(locale === "ar" ? "تعذّر الاتصال بالخادم." : "Failed to connect to server.");
    } finally {
      setBusy(false);
      setShowActivity(false);
    }
  }

  const allRecommendations = messages.flatMap(
    (m) => (m.recommendations as Recommendation[] | undefined) ?? [],
  );

  const inputPlaceholder = hasConversation
    ? t("chat.placeholder_followup")
    : t("chat.placeholder");

  // Fresh chat (no messages yet) → Phase A (Welcoming State).
  const isEmpty = messages.length === 0 && !busy;

  const getQuickActions = () => [
    {
      label: locale === "ar" ? "حلّل BTCUSDT" : "Analyze BTCUSDT",
      icon: LineChart,
      prompt: locale === "ar" ? "حلّل BTCUSDT" : "Analyze BTCUSDT",
    },
    {
      label: locale === "ar" ? "نظرة على السوق" : "Market Overview",
      icon: Search,
      prompt: locale === "ar" ? "نظرة على السوق اليوم" : "Market Overview Today",
    },
    {
      label: locale === "ar" ? "فحص مخاطر حسابي" : "Check Account Risk",
      icon: Sparkles,
      prompt: locale === "ar" ? "فحص مخاطر حسابي" : "Check account risk",
    },
  ];

  return (
    <div className="flex h-dvh min-h-0 flex-1 flex-col overflow-hidden bg-background pt-12 lg:h-full lg:pt-0">

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

              {/* Redesigned flat config settings bar */}
              <div className="w-full">
                <ChatModeBar sel={sel} onChange={setSel} />
              </div>

              {/* Dynamic Sugestion Pills */}
              <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg mt-1">
                {getQuickActions().map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => void send(action.prompt)}
                      className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-secondary hover:border-primary/30 active:scale-95 duration-100 shadow-sm"
                    >
                      <Icon className="h-3.5 w-3.5 text-primary" />
                      <span>{action.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Phase B: Operational Mode (Active State) */
            <ChatConversation
              messages={messages}
              busy={busy}
              showActivity={showActivity}
              activities={activities}
              hideActivityOnMobile
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
            />
          )}

          {executingIntentId !== null && intentActivities.length > 0 && (
            <div className="shrink-0 border-t border-border px-3 py-2 bg-card/40">
              <AgentActivityFeed
                activities={intentActivities}
                title={locale === "ar" ? "تنفيذ الصفقة" : "Executing Transaction"}
              />
            </div>
          )}

          {/* Chat Input Bar */}
          <ChatInputBar
            value={input}
            onChange={setInput}
            onSend={() => void send(input, pendingImage)}
            onPickPrompt={(p) => void send(p)}
            pendingImage={pendingImage}
            pendingImagePreview={pendingImagePreview}
            onImageSelect={(file) => void handleImageSelect(file)}
            onImageClear={clearPendingImage}
            imageError={imageError}
            disabled={busy}
            placeholder={inputPlaceholder}
            centered={false}
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
                symbol={previewSymbol}
                interval={previewInterval}
                onIntervalChange={setPreviewInterval}
                onSymbolChange={(s) => setPreviewSymbol(s.toUpperCase())}
                market={sel.market}
                recommendations={allRecommendations}
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
              symbol={previewSymbol}
              interval={previewInterval}
              onIntervalChange={setPreviewInterval}
              onSymbolChange={(s) => setPreviewSymbol(s.toUpperCase())}
              market={sel.market}
              recommendations={allRecommendations}
              className="h-full border-0"
            />
          </div>
        </div>
      )}

      {/* Conversation history drawer — collapsed by default */}
      <ChatSidebar open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
