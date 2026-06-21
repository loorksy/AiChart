"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, User, TrendingUp, TrendingDown, MinusCircle, Target, ShieldAlert, LogIn } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/types";
import type { UiMessage } from "@/stores/chat-store";
import { ChatIntentCard } from "./chat-intent-card";
import { UILayoutRenderer, validateUISchema } from "@/components/chat/widgets";

interface ChatMessageProps {
  message: UiMessage;
  busyIntentId?: number | null;
  onIntentApprove?: (id: number) => void;
  onIntentReject?: (id: number) => void;
  onQuestionSelect?: (value: string) => void;
  onWidgetAction?: (action: string, payload: any) => void;
}

export function ChatMessage({
  message,
  busyIntentId,
  onIntentApprove,
  onIntentReject,
  onQuestionSelect,
  onWidgetAction,
}: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      <Avatar className="h-7 w-7 shrink-0 rounded-lg sm:h-8 sm:w-8">
        <AvatarFallback
          className={cn(
            "rounded-lg",
            isUser
              ? "bg-secondary text-muted-foreground"
              : "bg-primary text-primary-foreground",
          )}
        >
          {isUser ? (
            <User className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
        </AvatarFallback>
      </Avatar>

      <div
        className={cn(
          "min-w-0 text-sm leading-relaxed",
          isUser
            ? "max-w-[calc(100%-2.5rem)] rounded-3xl bg-secondary px-4 py-2.5 text-foreground sm:max-w-[85%]"
            : "max-w-[calc(100%-2.5rem)] flex-1 pt-1 text-foreground sm:max-w-[85%]",
        )}
      >
        {isUser ? (
          <>
            {message.imageUrl && (
              <img
                src={message.imageUrl}
                alt="شارت مرفق"
                className="mb-2 max-h-48 w-full rounded-md border border-border object-contain"
              />
            )}
            <p className="whitespace-pre-wrap">{message.content}</p>
          </>
        ) : (
          <>
            <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0">
              <ReactMarkdown>{message.content || " "}</ReactMarkdown>
              {message.streaming && (
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent-gold align-middle" />
              )}
            </div>
            {(message.recommendations as Recommendation[] | undefined)?.map(
              (rec) => (
                <RecommendationSnippet key={rec.id} rec={rec} />
              ),
            )}
            {message.intents?.map((intent) => (
              <ChatIntentCard
                key={intent.id}
                intent={intent}
                busy={busyIntentId === intent.id}
                onApprove={onIntentApprove}
                onReject={onIntentReject}
              />
            ))}
            {message.ui_schema && onWidgetAction && (() => {
              const validated = validateUISchema(message.ui_schema);
              if (!validated) return null;
              return (
                <UILayoutRenderer
                  layout={validated.layout}
                  onAction={onWidgetAction}
                />
              );
            })()}
            {message.question && onQuestionSelect && (
              <ChatQuestionCard
                question={message.question}
                onSelect={onQuestionSelect}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RecommendationSnippet({ rec }: { rec: Recommendation }) {
  const isBuy = rec.action === "buy";
  const isSell = rec.action === "sell";
  const label = isBuy ? "شراء" : isSell ? "بيع" : "انتظار";

  const factors: string[] = (() => {
    if (!rec.factors) return [];
    try {
      const arr = JSON.parse(rec.factors);
      return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, 6) : [];
    } catch {
      return [];
    }
  })();

  const accent = isBuy
    ? { ring: "border-emerald-500/25", glow: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <TrendingUp className="h-3.5 w-3.5" /> }
    : isSell
      ? { ring: "border-rose-500/25", glow: "bg-rose-500", badge: "bg-rose-500/15 text-rose-400 border-rose-500/30", icon: <TrendingDown className="h-3.5 w-3.5" /> }
      : { ring: "border-amber-500/25", glow: "bg-amber-500", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: <MinusCircle className="h-3.5 w-3.5" /> };

  const conf = Math.max(0, Math.min(100, rec.confidence ?? 0));

  return (
    <div
      dir="rtl"
      className={cn(
        "relative mt-3 overflow-hidden rounded-2xl border bg-card/50 p-4 shadow-lg backdrop-blur-md transition-all duration-300 hover:shadow-xl",
        accent.ring,
      )}
    >
      <div className={cn("pointer-events-none absolute -left-16 -top-16 h-32 w-32 rounded-full opacity-[0.12] blur-[60px]", accent.glow)} />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight" dir="ltr">{rec.symbol}</span>
            {rec.timeframe && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" dir="ltr">{rec.timeframe}</span>
            )}
          </div>
          {rec.pattern_name && (
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{rec.pattern_name}</span>
          )}
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold", accent.badge)}>
          {accent.icon}
          {label}
        </span>
      </div>

      {/* Confidence bar */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>الثقة</span>
          <span className="font-semibold text-foreground">{conf}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-all", accent.glow)} style={{ width: `${conf}%` }} />
        </div>
      </div>

      {/* Levels */}
      {(rec.entry != null || rec.stop_loss != null || rec.take_profit != null) && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Level icon={<LogIn className="h-3 w-3" />} label="دخول" value={rec.entry} tone="text-foreground" />
          <Level icon={<ShieldAlert className="h-3 w-3" />} label="وقف" value={rec.stop_loss} tone="text-rose-400" />
          <Level icon={<Target className="h-3 w-3" />} label="هدف" value={rec.take_profit} tone="text-emerald-400" />
        </div>
      )}

      {/* Rationale */}
      {rec.rationale && (
        <p className="mt-3 rounded-xl border border-border/50 bg-background/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
          {rec.rationale}
        </p>
      )}

      {/* Factors */}
      {factors.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {factors.map((f, i) => (
            <span key={i} className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">
              {f}
            </span>
          ))}
        </div>
      )}

      {rec.chart_image_url && (
        <img
          src={rec.chart_image_url}
          alt={`شارت ${rec.symbol}`}
          className="mt-3 w-full rounded-xl border border-border"
          loading="lazy"
        />
      )}
    </div>
  );
}

function Level({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number | null;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/40 p-2 text-center">
      <span className="flex items-center justify-center gap-1 text-[9px] text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={cn("mt-0.5 block text-xs font-bold tabular-nums", tone)} dir="ltr">
        {value != null ? value : "—"}
      </span>
    </div>
  );
}

function ChatQuestionCard({
  question,
  onSelect,
}: {
  question: NonNullable<UiMessage["question"]>;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-card/65 backdrop-blur-md p-4 shadow-lg transition-all animate-in fade-in slide-in-from-bottom-2 duration-300">
      <p className="mb-3 text-sm font-semibold text-foreground leading-snug">
        {question.text}
      </p>
      <div className="flex flex-wrap gap-2">
        {question.options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className="inline-flex items-center justify-center rounded-lg bg-primary/10 px-3.5 py-2 text-xs font-medium text-primary border border-primary/20 hover:bg-primary/20 hover:border-primary/35 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
          >
            {opt.label}
          </button>
        ))}
        <button
          onClick={() => onSelect("إلغاء")}
          className="inline-flex items-center justify-center rounded-lg bg-destructive/10 px-3.5 py-2 text-xs font-medium text-destructive border border-destructive/20 hover:bg-destructive/20 hover:border-destructive/35 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
        >
          تراجع / إلغاء الأمر
        </button>
      </div>
    </div>
  );
}
