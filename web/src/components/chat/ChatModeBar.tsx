"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/LocaleProvider";

export interface ChatStartSelections {
  trading_style: "scalp" | "day" | "swing" | "position";
  mode: "auto" | "approval" | "direct";
  response_mode: "fast" | "expert" | "vision";
  /** Forex-only platform — kept for API payloads. */
  market: "forex";
  symbol: string;
}

export const DEFAULT_SELECTIONS: ChatStartSelections = {
  trading_style: "day",
  mode: "auto",
  response_mode: "expert",
  market: "forex",
  symbol: "",
};

type Setter = <K extends keyof ChatStartSelections>(
  k: K,
  v: ChatStartSelections[K],
) => void;

/** Shared label resolvers (kept in one place so popover + summaries match). */
function useSelectionLabels() {
  const { t } = useLocale();
  return {
    tradingStyle: (style: string) =>
      style === "scalp"
        ? t("term.scalping")
        : style === "day"
          ? t("term.day_trading")
          : style === "swing"
            ? t("term.swing_trading")
            : style === "position"
              ? t("settings.position")
              : style,
    mode: (mode: string) =>
      mode === "approval"
        ? t("mode.approval")
        : mode === "direct"
          ? t("mode.direct")
          : mode === "auto"
            ? t("mode.auto")
            : mode,
    responseMode: (rm: string) =>
      rm === "fast"
        ? t("response.fast")
        : rm === "expert"
          ? t("response.expert")
          : rm === "vision"
            ? t("response.vision")
            : rm,
  };
}

/** A labelled segmented control row used inside the settings popover. */
function SegmentedRow<K extends keyof ChatStartSelections>({
  label,
  field,
  options,
  current,
  set,
  render,
}: {
  label: string;
  field: K;
  options: readonly ChatStartSelections[K][];
  current: ChatStartSelections[K];
  set: Setter;
  render: (v: ChatStartSelections[K]) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold text-muted-foreground">
        {label}
      </label>
      <div className="flex flex-wrap gap-0.5 rounded-lg border border-border/40 bg-muted p-0.5">
        {options.map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => set(field, v)}
            className={cn(
              "flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all whitespace-nowrap",
              current === v
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {render(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Execution-mode picker — button shows the active mode label (default: auto). */
export function SessionSettingsPopover({
  sel,
  onChange,
  disabled,
}: {
  sel: ChatStartSelections;
  onChange: (s: ChatStartSelections) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const labels = useSelectionLabels();
  const modeLabel = labels.mode(sel.mode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const set: Setter = (k, v) => onChange({ ...sel, [k]: v });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
          open
            ? "bg-white/10 text-zinc-100"
            : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100",
        )}
        aria-label={modeLabel}
        title={modeLabel}
      >
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span>{modeLabel}</span>
      </button>

      {open && (
        <div
          dir="rtl"
          className="absolute bottom-full z-50 mb-2 w-[16rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in-0 zoom-in-95"
          style={{ insetInlineStart: 0 }}
        >
          <SegmentedRow
            label={t("welcome.execution_mode")}
            field="mode"
            options={["auto", "approval", "direct"] as const}
            current={sel.mode}
            set={set}
            render={labels.mode}
          />
        </div>
      )}
    </div>
  );
}
