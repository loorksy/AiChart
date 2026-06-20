"use client";

import { useState } from "react";
import Image from "next/image";
import { Zap, Gem, Eye, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { PairPicker } from "@/components/market/PairPicker";

export interface ChatStartSelections {
  trading_style: "scalp" | "day" | "swing" | "position";
  mode: "auto" | "approval" | "direct";
  response_mode: "fast" | "expert" | "vision";
  market: "crypto" | "forex";
  symbol: string;
}

const DEFAULTS: ChatStartSelections = {
  trading_style: "day",
  mode: "approval",
  response_mode: "expert",
  market: "crypto",
  symbol: "",
};

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode; hint?: string }[];
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-muted/40 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-primary/15 text-primary ring-1 ring-primary/30"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Pre-chat start screen — collects trading style + execution authority +
 * response depth + market + symbol before the conversation begins. Styled like
 * the Claude app mode picker. The selections ride the first /api/chat call.
 */
export function ChatStartScreen({
  displayName,
  onStart,
}: {
  displayName: string;
  onStart: (s: ChatStartSelections) => void;
}) {
  const [sel, setSel] = useState<ChatStartSelections>(DEFAULTS);
  const set = <K extends keyof ChatStartSelections>(
    k: K,
    v: ChatStartSelections[K],
  ) => setSel((s) => ({ ...s, [k]: v }));

  const responseHint =
    sel.response_mode === "fast"
      ? "ردود سريعة وموجزة للمحادثة اليومية"
      : sel.response_mode === "vision"
        ? "يركّز على قراءة الشارت بصرياً"
        : "تحليل خبير متعدد الأطر الزمنية";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 rounded-2xl border border-border bg-card/60 p-5 shadow-sm backdrop-blur-sm sm:p-7">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-2xl bg-gradient-to-tr from-primary/20 to-primary/5 p-2.5 ring-1 ring-primary/20">
          <Image src="/logo.png" alt="AiChart" width={40} height={40} className="rounded-xl" />
        </div>
        <div>
          <h1 className="text-xl font-bold">مرحباً {displayName} 👋</h1>
          <p className="text-sm text-muted-foreground">
            اضبط جلستك ثم ابدأ التداول بالمحادثة
          </p>
        </div>
      </div>

      {/* Response mode (like the screenshot) */}
      <div className="space-y-2">
        <label className="text-sm font-medium">نوع الرد</label>
        <Segmented
          value={sel.response_mode}
          onChange={(v) => set("response_mode", v)}
          options={[
            { value: "fast", label: "سريع", icon: <Zap className="h-4 w-4" /> },
            { value: "expert", label: "خبير", icon: <Gem className="h-4 w-4" /> },
            { value: "vision", label: "الرؤية", icon: <Eye className="h-4 w-4" /> },
          ]}
        />
        <p className="text-center text-xs text-muted-foreground">{responseHint}</p>
      </div>

      {/* Trading style */}
      <div className="space-y-2">
        <label className="text-sm font-medium">أسلوب التداول</label>
        <Segmented
          value={sel.trading_style}
          onChange={(v) => set("trading_style", v)}
          options={[
            { value: "scalp", label: "سكالب" },
            { value: "day", label: "يومي" },
            { value: "swing", label: "سوينغ" },
            { value: "position", label: "طويل" },
          ]}
        />
      </div>

      {/* Execution authority */}
      <div className="space-y-2">
        <label className="text-sm font-medium">صلاحية التنفيذ</label>
        <Segmented
          value={sel.mode}
          onChange={(v) => set("mode", v)}
          options={[
            { value: "approval", label: "موافقة" },
            { value: "direct", label: "مباشر" },
            { value: "auto", label: "تلقائي" },
          ]}
        />
      </div>

      {/* Market */}
      <div className="space-y-2">
        <label className="text-sm font-medium">المنصة</label>
        <Segmented
          value={sel.market}
          onChange={(v) => {
            set("market", v);
            set("symbol", ""); // reset symbol when market changes
          }}
          options={[
            { value: "crypto", label: "كريبتو" },
            { value: "forex", label: "فوركس" },
          ]}
        />
      </div>

      {/* Symbol — pair picker popup */}
      <div className="space-y-2">
        <label className="text-sm font-medium">الزوج (اختياري)</label>
        <PairPicker
          market={sel.market}
          value={sel.symbol}
          onChange={(s) => set("symbol", s)}
        />
      </div>

      <button
        type="button"
        onClick={() => onStart(sel)}
        className="btn btn-primary flex items-center justify-center gap-2"
      >
        ابدأ المحادثة
        <ArrowLeft className="h-4 w-4" />
      </button>
    </div>
  );
}
