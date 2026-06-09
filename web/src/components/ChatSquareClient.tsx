"use client";

import { useEffect, useState } from "react";
import { LineChart, X } from "lucide-react";
import { ChatWelcome } from "@/components/chat/square/chat-welcome";
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
  const [busyIntentId, setBusyIntentId] = useState<number | null>(null);
  const [executingIntentId, setExecutingIntentId] = useState<number | null>(
    null,
  );

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
  const displayName = me?.displayName ?? "متداول";
  const creditsRemaining = me?.quota.remaining;

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
            `لم تُنفّذ: ${(data as { reason?: string; error?: string }).reason ?? (data as { error?: string }).error ?? "سبب غير معروف"}`,
          );
        } else {
          const data = await consumeSse<{ ok: boolean; reason?: string }>(res, {
            onActivity: upsertIntentActivity,
            onError: (msg) => setError(msg),
          });
          if (data && !data.ok) {
            setError(`لم تُنفّذ: ${data.reason ?? "سبب غير معروف"}`);
          }
          patchMessageIntents(messageId, intentId, {
            status: data?.ok ? "executed" : "failed",
            reason: data?.reason,
          });
        }
      } else if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "تعذّر رفض الطلب.");
      } else {
        patchMessageIntents(messageId, intentId, { status: "rejected" });
      }
    } catch {
      setError("تعذّر معالجة الطلب.");
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

    const sym = extractSymbol(content);
    if (sym) {
      setPreviewSymbol(sym);
      setPreviewOpen(true);
    }

    let convId = selectedId;
    if (!convId) convId = await createNew();

    const displayText =
      content || (attach ? "حلّل الشارت المرفق وأعطني توصية." : "");

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
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "حدث خطأ.");
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
        if (!streamError) setError("لم يصل رد من الوكيل.");
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
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
      setShowActivity(false);
    }
  }

  const allRecommendations = messages.flatMap(
    (m) => (m.recommendations as Recommendation[] | undefined) ?? [],
  );

  const inputPlaceholder = hasConversation
    ? "تابع المحادثة…"
    : "اسأل الخبير عن السوق أو حسابك…";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* Chat toolbar — chart toggle only */}
      <div className="z-10 flex shrink-0 items-center justify-end border-b border-border bg-card/80 px-3 py-1.5 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setPreviewOpen((o) => !o)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition",
            previewOpen
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary",
          )}
        >
          <LineChart className="h-4 w-4" />
          الشارت
        </button>
      </div>

      {!agentReady && (
        <p className="shrink-0 border-b border-border bg-card/80 px-3 py-1.5 text-xs text-muted-foreground">
          وكيل Claude غير مُفعّل — أضِف ANTHROPIC_API_KEY من لوحة الإدارة.
        </p>
      )}
      {error && (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!hasConversation && !busy ? (
            <ChatWelcome
              displayName={displayName}
              model={model}
              creditsRemaining={creditsRemaining}
            />
          ) : (
            <ChatConversation
              messages={messages}
              busy={busy}
              showActivity={showActivity}
              activities={activities}
              hideActivityOnMobile
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
            <div className="shrink-0 border-t border-border px-3 py-2">
              <AgentActivityFeed
                activities={intentActivities}
                title="تنفيذ الصفقة"
              />
            </div>
          )}

          <ChatInputBar
            value={input}
            onChange={setInput}
            onSend={() => void send(input, pendingImage)}
            onPickPrompt={(p) => {
              if (hasConversation) void send(p);
              else setInput(p);
            }}
            pendingImage={pendingImage}
            pendingImagePreview={pendingImagePreview}
            onImageSelect={(file) => void handleImageSelect(file)}
            onImageClear={clearPendingImage}
            imageError={imageError}
            disabled={busy}
            placeholder={inputPlaceholder}
            model={model}
            creditsRemaining={creditsRemaining}
          />
        </div>

        {previewOpen && (
          <aside className="hidden h-full min-h-0 w-[min(42%,26rem)] shrink-0 flex-col overflow-hidden border-s border-border bg-card md:flex">
            <ChartPreviewPanel
              symbol={previewSymbol}
              interval={previewInterval}
              onIntervalChange={setPreviewInterval}
              recommendations={allRecommendations}
              onClose={() => setPreviewOpen(false)}
              className="h-full min-h-0 border-0"
            />
          </aside>
        )}
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-3 py-2">
            <span className="text-sm font-medium">معاينة الشارت</span>
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"
              aria-label="إغلاق الشارت"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChartPreviewPanel
              symbol={previewSymbol}
              interval={previewInterval}
              onIntervalChange={setPreviewInterval}
              recommendations={allRecommendations}
              className="h-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}
