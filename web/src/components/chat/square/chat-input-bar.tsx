"use client";

import { useRef } from "react";
import {
  ArrowUp,
  BarChart3,
  ImagePlus,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  SessionSettingsPopover,
  MarketPairControl,
  type ChatStartSelections,
} from "@/components/chat/ChatModeBar";
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

export interface Attachment {
  name: string;
  size: number;
  type: string;
  content: string;
}

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
  attachments?: Attachment[];
  onAddAttachment?: (file: File) => void;
  onRemoveAttachment?: (index: number) => void;
  disabled?: boolean;
  /** Agent is actively working — shows a spinner on the send button. */
  busy?: boolean;
  placeholder?: string;
  centered?: boolean;
  /** Session selections (market/style/mode/response) shown inside the composer. */
  selections?: ChatStartSelections;
  onSelectionsChange?: (s: ChatStartSelections) => void;
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
  attachments = [],
  onAddAttachment,
  onRemoveAttachment,
  disabled,
  busy = false,
  placeholder = "اسأل عن أي شيء…",
  centered = false,
  selections,
  onSelectionsChange,
}: ChatInputBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = Boolean(value.trim() || pendingImage || attachments.length > 0);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.indexOf("image") !== -1 && onImageSelect) {
          onImageSelect(file);
        } else if (onAddAttachment) {
          onAddAttachment(file);
        }
      }
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (file && onImageSelect) {
          onImageSelect(file);
        }
      } else if (item.kind === "file" && onAddAttachment) {
        const file = item.getAsFile();
        if (file) onAddAttachment(file);
      }
    }
  };

  return (
    <div
      className={cn(
        "shrink-0 px-3 py-3",
        centered
          ? "bg-transparent"
          : "border-t border-border/60 bg-background/80 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md",
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
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

        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1">
            {attachments.map((att, idx) => (
              <div key={idx} className="relative flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/60 p-2.5 text-xs text-zinc-300">
                <span className="font-semibold truncate max-w-[12rem]">{att.name}</span>
                <span className="text-[10px] text-muted-foreground">({(att.size / 1024).toFixed(1)} KB)</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(idx)}
                  disabled={disabled}
                  className="rounded-full hover:bg-white/10 p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                  aria-label="إزالة الملف"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {imageError && (
          <p className="px-1 text-xs text-destructive">{imageError}</p>
        )}

        <div className="chat-gpt-input flex flex-col gap-1 p-2.5">
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

          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={handlePaste}
            placeholder={
              pendingImage ? "أضف سؤالاً عن الشارت (اختياري)…" : placeholder
            }
            disabled={disabled}
            rows={1}
            className="min-h-[44px] max-h-32 w-full resize-none border-0 bg-transparent px-2 py-2 text-base leading-relaxed focus-visible:ring-0 focus-visible:outline-none text-zinc-100 placeholder:text-zinc-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
          />

          {/* Bottom toolbar — attach + session settings + market on the start,
              send on the end. Controls live in the box, never stealing chat space. */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-all hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-50"
              aria-label="إرفاق صورة شارت"
              title="إرفاق صورة"
            >
              <ImagePlus className="h-5 w-5" />
            </button>

            {selections && onSelectionsChange && (
              <>
                <SessionSettingsPopover
                  sel={selections}
                  onChange={onSelectionsChange}
                  disabled={disabled}
                />
                <MarketPairControl
                  sel={selections}
                  onChange={onSelectionsChange}
                  disabled={disabled}
                />
              </>
            )}

            <button
              type="button"
              disabled={busy || disabled || !canSend}
              onClick={onSend}
              className={cn(
                "ms-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-200 disabled:opacity-40 active:scale-95",
                busy
                  ? "bg-amber-500/90 text-white shadow-lg shadow-amber-500/20"
                  : canSend
                    ? "bg-green-500 hover:bg-green-600 text-white shadow-lg shadow-green-500/20"
                    : "bg-zinc-800 text-zinc-500",
              )}
              aria-label={busy ? "الوكيل يعمل…" : "إرسال"}
              title={busy ? "الوكيل يعمل…" : "إرسال"}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ArrowUp className="h-5 w-5" />
              )}
            </button>
          </div>
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
