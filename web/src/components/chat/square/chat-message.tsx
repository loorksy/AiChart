"use client";

import ReactMarkdown from "react-markdown";
import { Bot, User } from "lucide-react";
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
  const label =
    rec.action === "buy" ? "شراء" : rec.action === "sell" ? "بيع" : "انتظار";
  const color =
    rec.action === "buy"
      ? "text-green-500"
      : rec.action === "sell"
        ? "text-red-400"
        : "text-muted-foreground";

  return (
    <div className="mt-3 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold" dir="ltr">
          {rec.symbol}
        </span>
        <span className={cn("font-medium", color)}>
          {label} · {rec.confidence}%
        </span>
      </div>
      {rec.chart_image_url && (
        <img
          src={rec.chart_image_url}
          alt={`شارت ${rec.symbol}`}
          className="mt-2 w-full rounded-md border border-border"
          loading="lazy"
        />
      )}
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
