"use client";

import { Zap, Gem, Eye } from "lucide-react";
import { PairPicker } from "@/components/market/PairPicker";
import { cn } from "@/lib/utils";

export interface ChatStartSelections {
  trading_style: "scalp" | "day" | "swing" | "position";
  mode: "auto" | "approval" | "direct";
  response_mode: "fast" | "expert" | "vision";
  market: "crypto" | "forex";
  symbol: string;
}

export const DEFAULT_SELECTIONS: ChatStartSelections = {
  trading_style: "day",
  mode: "approval",
  response_mode: "expert",
  market: "crypto",
  symbol: "",
};

function Chips<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className="flex gap-1 rounded-lg bg-muted/40 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              value === o.value
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Compact inline session-mode bar shown ABOVE the chat input while a chat is
 * empty. Selecting modes then sending the first message starts the session —
 * no separate start screen / start button; the bar hides once chatting begins.
 */
export function ChatModeBar({
  sel,
  onChange,
}: {
  sel: ChatStartSelections;
  onChange: (s: ChatStartSelections) => void;
}) {
  const set = <K extends keyof ChatStartSelections>(
    k: K,
    v: ChatStartSelections[K],
  ) => onChange({ ...sel, [k]: v });

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card/60 px-3 py-2 backdrop-blur-sm">
        <Chips
          label="الرد"
          value={sel.response_mode}
          onChange={(v) => set("response_mode", v)}
          options={[
            { value: "fast", label: "سريع", icon: <Zap className="h-3 w-3" /> },
            { value: "expert", label: "خبير", icon: <Gem className="h-3 w-3" /> },
            { value: "vision", label: "رؤية", icon: <Eye className="h-3 w-3" /> },
          ]}
        />
        <Chips
          label="الأسلوب"
          value={sel.trading_style}
          onChange={(v) => set("trading_style", v)}
          options={[
            { value: "scalp", label: "سكالب" },
            { value: "day", label: "يومي" },
            { value: "swing", label: "سوينغ" },
            { value: "position", label: "طويل" },
          ]}
        />
        <Chips
          label="التنفيذ"
          value={sel.mode}
          onChange={(v) => set("mode", v)}
          options={[
            { value: "approval", label: "موافقة" },
            { value: "direct", label: "مباشر" },
            { value: "auto", label: "تلقائي" },
          ]}
        />
        <Chips
          label="السوق"
          value={sel.market}
          onChange={(v) => onChange({ ...sel, market: v, symbol: "" })}
          options={[
            { value: "crypto", label: "كريبتو" },
            { value: "forex", label: "فوركس" },
          ]}
        />
        <div className="min-w-[150px] flex-1">
          <PairPicker
            market={sel.market}
            value={sel.symbol}
            onChange={(s) => set("symbol", s)}
          />
        </div>
      </div>
    </div>
  );
}
