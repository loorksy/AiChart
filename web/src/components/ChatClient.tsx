"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, LineChart, User } from "lucide-react";
import type { Recommendation } from "@/lib/types";
import { VercelV0Chat } from "@/components/ui/v0-ai-chat";
import { ChartPreviewPanel } from "@/components/ui/chart-preview-panel";
import {
  AgentActivityFeed,
  AgentLoadingDots,
} from "@/components/ui/agent-activity-feed";
import { useAgentActivities } from "@/hooks/useAgentActivities";
import { needsAgentActivity } from "@/lib/agentActivity";
import { consumeSse } from "@/lib/sse";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  recommendations?: Recommendation[];
}

function extractSymbol(text: string): string | null {
  const m = text.match(/\b([A-Z]{2,10}USDT)\b/i);
  return m ? m[1].toUpperCase() : null;
}

export default function ChatClient({
  agentReady: agentReadyInitial,
}: {
  agentReady: boolean;
}) {
  const [agentReady, setAgentReady] = useState(agentReadyInitial);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "أهلاً، أنا **الخبير** — وكيل تداول يحلّل سوق Binance بصبر. اسألني عن أي عملة وسأعطيك رأيي بصراحة.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { activities, reset: resetActivities, upsert: upsertActivity } =
    useAgentActivities();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewSymbol, setPreviewSymbol] = useState("BTCUSDT");
  const [previewInterval, setPreviewInterval] = useState("1h");
  const endRef = useRef<HTMLDivElement>(null);
  const hasConversation = messages.length > 1;

  const allRecommendations = messages.flatMap((m) => m.recommendations ?? []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, activities]);

  useEffect(() => {
    void fetch("/api/chat/status")
      .then((r) => r.json())
      .then((d: { ready?: boolean }) => setAgentReady(Boolean(d.ready)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const pending = sessionStorage.getItem("aichart_pending_prompt");
    if (!pending) return;
    sessionStorage.removeItem("aichart_pending_prompt");
    void send(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPreview(symbol: string) {
    setPreviewSymbol(symbol);
    setPreviewOpen(true);
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setError(null);
    const sym = extractSymbol(content);
    if (sym) {
      setPreviewSymbol(sym);
      setPreviewOpen(true);
    }
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    const trackActivity = needsAgentActivity(content);
    setShowActivity(trackActivity);
    resetActivities();
    setBusy(true);
    try {
      const payload = {
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        stream: trackActivity,
      };
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (trackActivity) {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { error?: string }).error ?? "حدث خطأ.");
          return;
        }
        let streamError: string | null = null;
        const data = await consumeSse<{
          reply: string;
          recommendations?: Recommendation[];
        }>(res, {
          onActivity: upsertActivity,
          onError: (msg) => {
            streamError = msg;
            setError(msg);
          },
        });
        if (!data) {
          if (!streamError) setError("لم يصل رد من الوكيل. حاول مجدداً.");
          return;
        }
        const recs = data.recommendations;
        if (recs?.length) {
          setPreviewSymbol(recs[0].symbol);
          setPreviewOpen(true);
        } else if (sym) {
          setPreviewOpen(true);
        }
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.reply, recommendations: recs },
        ]);
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "حدث خطأ.");
        return;
      }
      const recs = data.recommendations as Recommendation[] | undefined;
      if (recs?.length) {
        setPreviewSymbol(recs[0].symbol);
        setPreviewOpen(true);
      } else if (sym) {
        setPreviewOpen(true);
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, recommendations: recs },
      ]);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
      setShowActivity(false);
    }
  }

  const chatPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      {!agentReady && (
        <div className="mx-auto w-full max-w-3xl px-4 pt-3">
          <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            الذكاء الاصطناعي غير مُفعّل (ينقص OPENAI_API_KEY).
          </p>
        </div>
      )}

      <div
        className={cn(
          "flex flex-1 flex-col",
          hasConversation ? "justify-between" : "justify-center",
        )}
      >
        {!hasConversation ? (
          <VercelV0Chat
            value={input}
            onChange={setInput}
            onSend={send}
            disabled={busy}
            loading={busy}
            subtitle="تحدّث مع وكيل يراقب السوق ويتحرّك عند الفرصة المناسبة فقط."
          />
        ) : (
          <>
            <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {messages.map((m, i) => (
                <MessageBubble
                  key={i}
                  message={m}
                  onPreview={openPreview}
                />
              ))}
              {busy && (
                <AgentWorkingRow
                  showActivity={showActivity}
                  activities={activities}
                />
              )}
              <div ref={endRef} />
            </div>
            <div className="border-t border-border/50 bg-card/60 px-4 py-3 backdrop-blur-md">
              <VercelV0Chat
                compact
                showActions={false}
                value={input}
                onChange={setInput}
                onSend={send}
                disabled={busy}
                loading={busy}
                placeholder="تابع المحادثة…"
              />
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="mx-auto mb-3 max-w-3xl px-4 text-sm text-destructive">{error}</p>
      )}

      {/* Mobile preview toggle */}
      {!previewOpen && hasConversation && (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="fixed bottom-20 left-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg md:hidden"
        >
          <LineChart className="h-4 w-4" />
          الشارت
        </button>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div
        className={cn(
          "flex min-h-0 flex-col transition-all duration-300",
          previewOpen && !previewExpanded
            ? "w-full md:w-1/2 lg:w-[45%]"
            : previewExpanded
              ? "hidden"
              : "w-full",
        )}
      >
        {chatPane}
      </div>

      {/* Desktop IDE preview */}
      {previewOpen && !previewExpanded && (
        <div className="hidden min-h-0 w-1/2 flex-col lg:w-[55%] md:flex">
          <ChartPreviewPanel
            symbol={previewSymbol}
            interval={previewInterval}
            onIntervalChange={setPreviewInterval}
            recommendations={allRecommendations}
            onClose={() => setPreviewOpen(false)}
            expanded={previewExpanded}
            onToggleExpand={() => setPreviewExpanded(true)}
            className="min-h-[calc(100dvh-57px)]"
          />
        </div>
      )}

      {previewOpen && previewExpanded && (
        <div className="hidden min-h-0 flex-1 md:flex">
          <ChartPreviewPanel
            symbol={previewSymbol}
            interval={previewInterval}
            onIntervalChange={setPreviewInterval}
            recommendations={allRecommendations}
            onClose={() => {
              setPreviewExpanded(false);
              setPreviewOpen(false);
            }}
            expanded
            onToggleExpand={() => setPreviewExpanded(false)}
            className="min-h-[calc(100dvh-57px)] w-full"
          />
        </div>
      )}

      {/* Mobile full-screen preview */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
          <ChartPreviewPanel
            symbol={previewSymbol}
            interval={previewInterval}
            onIntervalChange={setPreviewInterval}
            recommendations={allRecommendations}
            onClose={() => setPreviewOpen(false)}
            className="h-full"
          />
        </div>
      )}
    </div>
  );
}

function AgentWorkingRow({
  showActivity,
  activities,
}: {
  showActivity: boolean;
  activities: ReturnType<typeof useAgentActivities>["activities"];
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        {showActivity && activities.length > 0 ? (
          <AgentActivityFeed activities={activities} />
        ) : (
          <div className="surface-card rounded-xl px-4 py-3">
            <AgentLoadingDots />
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  message: m,
  onPreview,
}: {
  message: ChatMessage;
  onPreview: (symbol: string) => void;
}) {
  const isUser = m.role === "user";

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          isUser ? "bg-secondary" : "bg-primary/15",
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className={cn("max-w-[88%] space-y-2", isUser && "text-left")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed",
            isUser ? "bg-secondary text-foreground" : "surface-card text-card-foreground",
          )}
        >
          <p className="whitespace-pre-wrap">{m.content}</p>
        </div>
        {m.recommendations?.map((r) => (
          <RecCard key={r.id} rec={r} onPreview={() => onPreview(r.symbol)} />
        ))}
      </div>
    </div>
  );
}

function RecCard({ rec, onPreview }: { rec: Recommendation; onPreview: () => void }) {
  const label =
    rec.action === "buy" ? "شراء" : rec.action === "sell" ? "بيع" : "انتظار";
  const color =
    rec.action === "buy"
      ? "text-green-600"
      : rec.action === "sell"
        ? "text-red-500"
        : "text-muted-foreground";

  return (
    <div className="surface-card rounded-xl p-4 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-bold" dir="ltr">
          {rec.symbol}
        </span>
        <span className={cn("text-xs font-semibold", color)}>
          {label} · {rec.confidence}%
        </span>
      </div>
      {rec.rationale && (
        <p className="mb-3 text-xs text-muted-foreground">{rec.rationale}</p>
      )}
      {rec.chart_image_url && (
        <img
          src={rec.chart_image_url}
          alt={`شارت ${rec.symbol}`}
          className="mb-3 w-full rounded-lg border border-border"
          loading="lazy"
        />
      )}
      <button
        type="button"
        onClick={onPreview}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-secondary py-2 text-xs font-medium hover:bg-muted"
      >
        <LineChart className="h-3.5 w-3.5" />
        معاينة الشارت
      </button>
    </div>
  );
}
