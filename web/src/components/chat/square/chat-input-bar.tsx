"use client";

import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { PillButton } from "@/components/ui/shell";
import type { ChatImagePayload } from "@/lib/chatImage";

const QUICK_PILLS = [
  "حلّل BTCUSDT",
  "نظرة على السوق اليوم",
  "فحص مخاطر حسابي",
  "آخر توصياتي",
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
  model?: string | null;
  creditsRemaining?: number;
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
  placeholder = "اكتب رسالتك…",
  model,
  creditsRemaining,
}: ChatInputBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = Boolean(value.trim() || pendingImage);

  return (
    <div className="shrink-0 border-t border-border bg-background/95 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md">
      <div className="mx-auto w-full max-w-3xl space-y-2">
        {(model != null || creditsRemaining != null) && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground">
            {model && (
              <span>
                الموديل: <span dir="ltr" className="font-mono">{model}</span>
              </span>
            )}
            {creditsRemaining != null && (
              <span>1 رصيد لكل رسالة • {creditsRemaining} متبقّي</span>
            )}
          </div>
        )}

        {pendingImagePreview && (
          <div className="relative inline-block px-1">
            <img
              src={pendingImagePreview}
              alt="صورة مرفقة"
              className="h-20 w-auto max-w-[10rem] rounded-lg border border-border object-cover"
            />
            <button
              type="button"
              onClick={onImageClear}
              disabled={disabled}
              className="absolute -left-1 -top-1 rounded-full border border-border bg-card p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="إزالة الصورة"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {imageError && (
          <p className="px-1 text-xs text-destructive">{imageError}</p>
        )}

        <div className="flex gap-2 rounded-[var(--radius)] border border-border bg-card p-2 shadow-sm">
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
            className="self-end rounded-full p-2.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
            aria-label="إرفاق صورة شارت"
            title="إرفاق صورة شارت"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={pendingImage ? "أضف سؤالاً عن الشارت (اختياري)…" : placeholder}
            disabled={disabled}
            className="min-h-[48px] max-h-32 flex-1 resize-none border-0 bg-transparent text-base focus-visible:ring-0"
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
            className="self-end rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            إرسال
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {QUICK_PILLS.map((p) => (
            <PillButton
              key={p}
              variant="outline"
              disabled={disabled}
              className="shrink-0 whitespace-nowrap px-3 py-1.5 text-xs"
              onClick={() => onPickPrompt?.(p)}
            >
              {p}
            </PillButton>
          ))}
        </div>
      </div>
    </div>
  );
}
