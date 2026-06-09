"use client";

import { useRef } from "react";
import {
  ArrowUp,
  BarChart3,
  ImagePlus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { ChatImagePayload } from "@/lib/chatImage";
import { cn } from "@/lib/utils";

const QUICK_ACTIONS = [
  {
    label: "حلّل BTCUSDT",
    icon: BarChart3,
    prompt: "حلّل BTCUSDT",
  },
  {
    label: "نظرة على السوق",
    icon: Search,
    prompt: "نظرة على السوق اليوم",
  },
  {
    label: "فحص مخاطر حسابي",
    icon: Sparkles,
    prompt: "فحص مخاطر حسابي",
  },
] as const;

interface ChatInputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onPickPrompt?: (text: string) => void;
  pendingImage?: ChatImagePayload | null;
  pendingImagePreview?: string | null;
  onImageSelect?: (file: File) => void;
  onImageClear?: () => void;
  imageError?: string | null;
  disabled?: boolean;
  placeholder?: string;
  centered?: boolean;
}

export function ChatInputBar({
  value,
  onChange,
  onSend,
  onPickPrompt,
  pendingImage,
  pendingImagePreview,
  onImageSelect,
  onImageClear,
  imageError,
  disabled,
  placeholder = "اسأل عن أي شيء…",
  centered = false,
}: ChatInputBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = Boolean(value.trim() || pendingImage);

  return (
    <div
      className={cn(
        "shrink-0 px-3 py-3",
        centered
          ? "bg-transparent"
          : "border-t border-border/60 bg-background/80 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md",
      )}
    >
      <div className="mx-auto w-full max-w-3xl space-y-3">
        {pendingImagePreview && (
          <div className="relative inline-block px-1">
            <img
              src={pendingImagePreview}
              alt="صورة مرفقة"
              className="h-20 w-auto max-w-[10rem] rounded-xl border border-border object-cover"
            />
            <button
              type="button"
              onClick={onImageClear}
              disabled={disabled}
              className="absolute -start-1 -top-1 rounded-full border border-border bg-card p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="إزالة الصورة"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {imageError && (
          <p className="px-1 text-xs text-destructive">{imageError}</p>
        )}

        <div className="chat-gpt-input flex items-end gap-1 p-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImageSelect?.(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className="shrink-0 rounded-full p-2.5 text-muted-foreground transition hover:bg-secondary/80 hover:text-foreground disabled:opacity-50"
            aria-label="إرفاق صورة شارت"
            title="إرفاق صورة"
          >
            <ImagePlus className="h-5 w-5" />
          </button>

          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              pendingImage ? "أضف سؤالاً عن الشارت (اختياري)…" : placeholder
            }
            disabled={disabled}
            rows={1}
            className="min-h-[44px] max-h-32 flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-base leading-relaxed focus-visible:ring-0 focus-visible:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
          />

          <button
            type="button"
            disabled={disabled || !canSend}
            onClick={onSend}
            className={cn(
              "mb-0.5 shrink-0 rounded-full p-2 transition disabled:opacity-40",
              canSend
                ? "bg-foreground text-background hover:opacity-90"
                : "bg-secondary text-muted-foreground",
            )}
            aria-label="إرسال"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>

        {centered && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPickPrompt?.(action.prompt)}
                  className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 text-sm text-foreground transition hover:bg-secondary/80 disabled:opacity-50"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {action.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
