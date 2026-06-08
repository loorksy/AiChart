"use client";

import ReactMarkdown from "react-markdown";
import { Bot, User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/types";
import type { UiMessage } from "@/stores/chat-store";

interface ChatMessageProps {
  message: UiMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      <Avatar className="h-7 w-7 shrink-0 rounded-lg sm:h-8 sm:w-8">
        <AvatarFallback className="rounded-lg">
          {isUser ? (
            <User className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
        </AvatarFallback>
      </Avatar>

      <div
        className={cn(
          "min-w-0 max-w-[calc(100%-2.5rem)] rounded-xl border px-3 py-2.5 text-sm leading-relaxed sm:max-w-[85%] sm:px-4 sm:py-3",
          isUser
            ? "border-primary/30 bg-primary/10 text-foreground"
            : "border-border bg-card text-foreground",
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
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" />
              )}
            </div>
            {(message.recommendations as Recommendation[] | undefined)?.map(
              (rec) => (
                <RecommendationSnippet key={rec.id} rec={rec} />
              ),
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
