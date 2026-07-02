"use client";

import { useEffect } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Clock3,
  ShieldAlert,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { formatLevel } from "@/components/market/formatLevel";
import type { LiveReasoningEntry } from "@/lib/analysis/chartAnalyzeLlm";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Post-analysis interactive result sheet — dismissible, responsive, RTL. */
export function AnalysisResultModal({
  open,
  onClose,
  symbol,
  interval,
  recommendation,
  targets = [],
  riskReward,
  narrative,
  reasoningLog = [],
  onExecute,
  executing,
}: {
  open: boolean;
  onClose: () => void;
  symbol: string;
  interval: string;
  recommendation?: Recommendation | null;
  targets?: number[];
  riskReward?: number | null;
  narrative?: string;
  reasoningLog?: LiveReasoningEntry[];
  onExecute?: () => void;
  executing?: boolean;
}) {
  // Escape closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const action = recommendation?.action;
  const isTrade = action === "buy" || action === "sell";
  const confidence = Math.min(100, Math.max(0, recommendation?.confidence ?? 0));
  const tps =
    targets.length > 0
      ? targets.filter((t) => t > 0)
      : recommendation?.take_profit && recommendation.take_profit > 0
        ? [recommendation.take_profit]
        : [];

  const headBg = isTrade
    ? action === "buy"
      ? "from-emerald-500/25 via-emerald-500/10"
      : "from-red-500/25 via-red-500/10"
    : "from-amber-500/20 via-amber-500/5";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      dir="rtl"
    >
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div className="relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border/70 bg-card shadow-2xl sm:rounded-2xl">
        {/* Header */}
        <div className={cn("bg-gradient-to-b to-transparent px-5 pb-3 pt-4", headBg)}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {isTrade ? (
                action === "buy" ? (
                  <ArrowUpCircle className="h-9 w-9 text-emerald-400" />
                ) : (
                  <ArrowDownCircle className="h-9 w-9 text-red-400" />
                )
              ) : (
                <Clock3 className="h-9 w-9 text-amber-400" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-foreground">
                    {isTrade ? (action === "buy" ? "توصية شراء" : "توصية بيع") : "انتظار — لا صفقة الآن"}
                  </h2>
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <p className="text-xs text-muted-foreground" dir="ltr">
                  {symbol} · {interval}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق النتيجة"
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Confidence bar */}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>مستوى الثقة</span>
              <span dir="ltr">{confidence}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  confidence >= 75
                    ? "bg-emerald-500"
                    : confidence >= 55
                      ? "bg-amber-500"
                      : "bg-red-500",
                )}
                style={{ width: `${confidence}%` }}
              />
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isTrade && (
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2 py-2.5">
                <p className="text-[10px] text-emerald-300/80">دخول</p>
                <p className="text-sm font-bold text-emerald-300" dir="ltr">
                  {formatLevel(recommendation?.entry ?? null)}
                </p>
              </div>
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-2 py-2.5">
                <p className="flex items-center justify-center gap-1 text-[10px] text-red-300/80">
                  <ShieldAlert className="h-3 w-3" /> وقف خسارة
                </p>
                <p className="text-sm font-bold text-red-300" dir="ltr">
                  {formatLevel(recommendation?.stop_loss ?? null)}
                </p>
              </div>
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-2 py-2.5">
                <p className="flex items-center justify-center gap-1 text-[10px] text-blue-300/80">
                  <Target className="h-3 w-3" /> {tps.length > 1 ? "الأهداف" : "هدف"}
                </p>
                <p className="text-sm font-bold text-blue-300" dir="ltr">
                  {tps.length > 0 ? tps.map((t) => formatLevel(t)).join(" · ") : "—"}
                </p>
              </div>
            </div>
          )}

          {isTrade && riskReward != null && riskReward > 0 && (
            <p className="mb-4 text-center text-xs text-muted-foreground">
              العائد/المخاطرة{" "}
              <span className="font-bold text-foreground" dir="ltr">
                1 : {riskReward.toFixed(1)}
              </span>
            </p>
          )}

          {narrative && (
            <div className="mb-4 rounded-xl border border-border/60 bg-muted/30 p-3">
              <p className="whitespace-pre-wrap text-[13px] leading-6 text-foreground/90">
                {narrative}
              </p>
            </div>
          )}

          {reasoningLog.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                خطوات التحليل
              </h3>
              <ul className="space-y-1.5">
                {reasoningLog.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-lg bg-muted/20 px-2.5 py-1.5 text-[12px] leading-5 text-foreground/85"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                    {e.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-border/60 px-5 py-3">
          {isTrade && onExecute && (
            <button
              type="button"
              onClick={onExecute}
              disabled={executing}
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {executing ? "جارٍ التنفيذ…" : "موافقة وتنفيذ"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted",
              !(isTrade && onExecute) && "flex-1",
            )}
          >
            متابعة على الشارت
          </button>
        </div>
      </div>
    </div>
  );
}
