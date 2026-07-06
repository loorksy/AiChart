"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MessageLoading } from "@/components/ui/message-loading";
import {
  ArrowUpIcon,
  BarChart3,
  LineChart,
  Paperclip,
  Shield,
  TrendingUp,
} from "lucide-react";

function useAutoResizeTextarea(minHeight: number, maxHeight?: number) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const ta = textareaRef.current;
      if (!ta) return;
      if (reset) {
        ta.style.height = `${minHeight}px`;
        return;
      }
      ta.style.height = `${minHeight}px`;
      ta.style.height = `${Math.max(minHeight, Math.min(ta.scrollHeight, maxHeight ?? Infinity))}px`;
    },
    [minHeight, maxHeight],
  );
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) ta.style.height = `${minHeight}px`;
  }, [minHeight]);
  return { textareaRef, adjustHeight };
}

export interface AiChatAction {
  icon: React.ReactNode;
  label: string;
  prompt: string;
}

const DEFAULT_ACTIONS: AiChatAction[] = [
  { icon: <TrendingUp className="h-4 w-4" />, label: "تحليل EURUSD", prompt: "ما رأيك في EURUSD الآن؟" },
  { icon: <LineChart className="h-4 w-4" />, label: "فرص اليوم", prompt: "هل توجد فرصة تداول جيدة اليوم؟" },
  { icon: <BarChart3 className="h-4 w-4" />, label: "تحليل الذهب", prompt: "حلّل XAUUSD على إطار الساعة." },
  { icon: <Shield className="h-4 w-4" />, label: "المخاطر", prompt: "راجع إعدادات المخاطر الحالية." },
];

export interface VercelV0ChatProps {
  title?: string;
  subtitle?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSend?: (value: string) => void;
  disabled?: boolean;
  showActions?: boolean;
  actions?: AiChatAction[];
  compact?: boolean;
  loading?: boolean;
}

export function VercelV0Chat({
  title = "ماذا ستتداول اليوم؟",
  subtitle,
  placeholder = "اسأل الخبير عن أي عملة أو سوق…",
  value: controlledValue,
  onChange,
  onSend,
  disabled = false,
  showActions = true,
  actions = DEFAULT_ACTIONS,
  compact = false,
  loading = false,
}: VercelV0ChatProps) {
  const [internalValue, setInternalValue] = useState("");
  const value = controlledValue ?? internalValue;
  const setValue = onChange ?? setInternalValue;
  const { textareaRef, adjustHeight } = useAutoResizeTextarea(56, 180);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || loading) return;
    onSend?.(text);
    if (!onChange) setInternalValue("");
    else onChange("");
    adjustHeight(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-center px-4",
        compact ? "max-w-3xl" : "max-w-3xl",
        !compact && "py-6",
      )}
    >
      {!compact && (
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
              {subtitle}
            </p>
          )}
        </div>
      )}

      <div className="surface-prompt w-full overflow-hidden">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || loading}
          className="min-h-[56px] w-full resize-none border-0 bg-transparent px-4 py-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:ring-0"
          style={{ overflow: "hidden" }}
        />
        <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-2">
          <button
            type="button"
            disabled={disabled}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40"
            aria-label="إرفاق"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={disabled || loading || !value.trim()}
            aria-label="إرسال"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full transition",
              value.trim() && !disabled && !loading
                ? "bg-zinc-900 text-white hover:bg-zinc-800"
                : "bg-zinc-200 text-zinc-400",
            )}
          >
            {loading ? <MessageLoading /> : <ArrowUpIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {showActions && !compact && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={disabled || loading}
              onClick={() => {
                setValue(a.prompt);
                onSend?.(a.prompt);
              }}
              className="flex items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-2 text-xs text-foreground backdrop-blur-sm transition hover:bg-card disabled:opacity-40"
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
