"use client";

import { useEffect, useRef, useState } from "react";
import {
  Zap,
  Gem,
  Eye,
  Gauge,
  ShieldCheck,
  Coins,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { PairPicker } from "@/components/market/PairPicker";
import { cn } from "@/lib/utils";
// cn is used for the collapse chevron rotation

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

interface Opt<T> {
  value: T;
  label: string;
}

/** A compact icon button that opens a small popover of options. */
function IconSelect<T extends string>({
  icon,
  title,
  value,
  options,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  value: T;
  options: Opt<T>[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition hover:border-primary/40"
      >
        <span className="text-muted-foreground">{icon}</span>
        <span className="font-medium">{current?.label}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute bottom-full z-50 mb-1 min-w-[10rem] overflow-hidden rounded-xl border border-border bg-card p-1 shadow-xl">
          <p className="px-2 py-1 text-[10px] text-muted-foreground">{title}</p>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-right text-xs transition",
                o.value === value
                  ? "bg-primary/15 text-primary"
                  : "text-foreground hover:bg-secondary/60",
              )}
            >
              {o.label}
              {o.value === value && <span className="text-primary">●</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compact icon-based session-mode bar shown above the chat input while a chat
 * is empty. Each setting is a small icon chip that opens a popover; the pair is
 * a dedicated popover. Selecting + sending the first message starts the session.
 */
export function ChatModeBar({
  sel,
  onChange,
}: {
  sel: ChatStartSelections;
  onChange: (s: ChatStartSelections) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const set = <K extends keyof ChatStartSelections>(
    k: K,
    v: ChatStartSelections[K],
  ) => onChange({ ...sel, [k]: v });

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-2">
      {/* Toggle row */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between rounded-xl border border-border/50 bg-card/40 px-3 py-2 text-xs text-muted-foreground transition hover:bg-card/70 hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          إعدادات الجلسة · {sel.trading_style} · {sel.mode} · {sel.market}
          {sel.symbol && ` · ${sel.symbol}`}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Collapsible options */}
      {expanded && (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <IconSelect
          icon={
            sel.response_mode === "fast" ? (
              <Zap className="h-3.5 w-3.5" />
            ) : sel.response_mode === "vision" ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <Gem className="h-3.5 w-3.5" />
            )
          }
          title="نوع الرد"
          value={sel.response_mode}
          onChange={(v) => set("response_mode", v)}
          options={[
            { value: "fast", label: "سريع" },
            { value: "expert", label: "خبير" },
            { value: "vision", label: "رؤية" },
          ]}
        />
        <IconSelect
          icon={<Gauge className="h-3.5 w-3.5" />}
          title="أسلوب التداول"
          value={sel.trading_style}
          onChange={(v) => set("trading_style", v)}
          options={[
            { value: "scalp", label: "سكالب" },
            { value: "day", label: "يومي" },
            { value: "swing", label: "سوينغ" },
            { value: "position", label: "طويل" },
          ]}
        />
        <IconSelect
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          title="صلاحية التنفيذ"
          value={sel.mode}
          onChange={(v) => set("mode", v)}
          options={[
            { value: "approval", label: "موافقة" },
            { value: "direct", label: "مباشر" },
            { value: "auto", label: "تلقائي" },
          ]}
        />
        <IconSelect
          icon={<Coins className="h-3.5 w-3.5" />}
          title="السوق"
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
            placement="up"
            onChange={(s) => set("symbol", s)}
          />
        </div>
      </div>
      )}
    </div>
  );
}
