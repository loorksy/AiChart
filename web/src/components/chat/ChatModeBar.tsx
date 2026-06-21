"use client";

import { useState } from "react";
import {
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import { PairPicker } from "@/components/market/PairPicker";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/LocaleProvider";

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

export function ChatModeBar({
  sel,
  onChange,
}: {
  sel: ChatStartSelections;
  onChange: (s: ChatStartSelections) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLocale();

  const set = <K extends keyof ChatStartSelections>(
    k: K,
    v: ChatStartSelections[K],
  ) => onChange({ ...sel, [k]: v });

  // Map values to translations
  const getTradingStyleLabel = (style: string) => {
    switch (style) {
      case "scalp":
        return t("term.scalping"); // "سكالبينج"
      case "day":
        return t("term.day_trading"); // "تداول يومي"
      case "swing":
        return t("term.swing_trading"); // "سوينج"
      case "position":
        return t("settings.position"); // "طويل"
      default:
        return style;
    }
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case "approval":
        return t("mode.approval");
      case "direct":
        return t("mode.direct");
      case "auto":
        return t("mode.auto");
      default:
        return mode;
    }
  };

  const getResponseModeLabel = (rm: string) => {
    switch (rm) {
      case "fast":
        return t("response.fast");
      case "expert":
        return t("response.expert");
      case "vision":
        return t("response.vision");
      default:
        return rm;
    }
  };

  const getMarketLabel = (m: string) => {
    switch (m) {
      case "crypto":
        return t("market.crypto");
      case "forex":
        return t("market.forex");
      default:
        return m;
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-2">
      {/* Collapsed Toggle Summary Bar */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3 text-xs font-medium text-foreground shadow-sm transition hover:bg-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          <span className="font-semibold">{t("welcome.session_settings")} ·</span>
          <span className="text-muted-foreground">
            {getResponseModeLabel(sel.response_mode)} · {getTradingStyleLabel(sel.trading_style)} · {getModeLabel(sel.mode)} · {getMarketLabel(sel.market)}
            {sel.symbol && ` · ${sel.symbol}`}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Flat Expanded Controls */}
      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-4 rounded-xl border border-border/80 bg-card p-4 shadow-md sm:grid-cols-2">
          
          {/* Response Mode Segmented Control */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("welcome.response_mode")}
            </label>
            <div className="flex rounded-lg bg-muted p-0.5 border border-border/40 w-full sm:w-fit">
              {(["fast", "expert", "vision"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set("response_mode", v)}
                  className={cn(
                    "flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                    sel.response_mode === v
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {getResponseModeLabel(v)}
                </button>
              ))}
            </div>
          </div>

          {/* Trading Style Segmented Control */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("welcome.trading_style")}
            </label>
            <div className="flex flex-wrap rounded-lg bg-muted p-0.5 border border-border/40 w-full sm:w-fit">
              {(["scalp", "day", "swing", "position"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set("trading_style", v)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                    sel.trading_style === v
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {getTradingStyleLabel(v)}
                </button>
              ))}
            </div>
          </div>

          {/* Execution Mode Segmented Control */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("welcome.execution_mode")}
            </label>
            <div className="flex rounded-lg bg-muted p-0.5 border border-border/40 w-full sm:w-fit">
              {(["approval", "direct", "auto"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set("mode", v)}
                  className={cn(
                    "flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                    sel.mode === v
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {getModeLabel(v)}
                </button>
              ))}
            </div>
          </div>

          {/* Market & Pair Picker Group */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("welcome.market")}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex rounded-lg bg-muted p-0.5 border border-border/40 w-full sm:w-fit shrink-0">
                {(["crypto", "forex"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => onChange({ ...sel, market: v, symbol: "" })}
                    className={cn(
                      "flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                      sel.market === v
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {getMarketLabel(v)}
                  </button>
                ))}
              </div>
              <div className="min-w-[140px] flex-1">
                <PairPicker
                  market={sel.market}
                  value={sel.symbol}
                  placement="up"
                  onChange={(s) => set("symbol", s)}
                />
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
