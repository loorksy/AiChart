"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { smartTipKey } from "@/lib/recommendations/smartTip";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

function fmtTime(ms?: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

interface Step {
  key: string;
  labelKey: string;
  at?: number;
  reached: boolean;
  tone: "sl" | "entered" | "tp";
}

function CopyPrice({ value }: { value: number }) {
  const [copied, setCopied] = useState(false);
  const { t } = useLocale();
  return (
    <button
      type="button"
      aria-label={copied ? t("rec.copied") : t("rec.copy")}
      onClick={() => {
        void navigator.clipboard?.writeText(String(value)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * Professional, localized, responsive recommendation tracker card:
 * lifecycle bar (SL / Entered / TP1 / TP2 / TP3), entry type, copyable
 * Entry/SL/TP rows, and a deterministic Smart Tip.
 */
export function RecommendationTrackerCard({
  rec,
}: {
  rec: TrackedRecommendation;
}) {
  const { t, dir } = useLocale();

  const entered = Boolean(rec.triggeredAt) || rec.entryType === "market";
  const slReached = rec.outcome === "loss" || Boolean(rec.slHitAt);
  const steps: Step[] = [
    { key: "sl", labelKey: "rec.step.sl", at: rec.slHitAt, reached: slReached, tone: "sl" },
    { key: "entered", labelKey: "rec.step.entered", at: rec.triggeredAt, reached: entered, tone: "entered" },
    { key: "tp1", labelKey: "rec.step.tp1", at: rec.tp1HitAt, reached: Boolean(rec.tp1HitAt), tone: "tp" },
    { key: "tp2", labelKey: "rec.step.tp2", at: rec.tp2HitAt, reached: Boolean(rec.tp2HitAt), tone: "tp" },
    { key: "tp3", labelKey: "rec.step.tp3", at: rec.tp3HitAt, reached: Boolean(rec.tp3HitAt), tone: "tp" },
  ];

  const dotClass = (s: Step) => {
    if (!s.reached) return "bg-muted-foreground/30";
    if (s.tone === "sl") return "bg-red-500";
    if (s.tone === "entered") return "bg-amber-500";
    return "bg-emerald-500";
  };

  const rows = [
    { labelKey: "rec.row.entry", value: rec.entry, color: "text-amber-500" },
    { labelKey: "rec.row.stop_loss", value: rec.stopLoss, color: "text-red-500" },
    ...rec.targets.slice(0, 3).map((v, i) => ({
      labelKey: `rec.row.target${i + 1}`,
      value: v,
      color: "text-emerald-500",
    })),
  ];

  const dirColor = rec.direction === "buy" ? "text-emerald-500" : "text-red-500";

  return (
    <div
      dir={dir}
      className="rounded-xl border border-border/60 bg-card p-3 text-sm shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground" dir="ltr">
          {rec.symbol} · {rec.interval}
        </span>
        <span className={`text-xs font-bold ${dirColor}`}>
          {rec.direction === "buy" ? t("decision.buy") : t("decision.sell")}
          {rec.setupType ? ` · ${rec.setupType}` : ""}
        </span>
      </div>

      {/* Lifecycle bar */}
      <div className="mb-3 flex items-stretch justify-between gap-1">
        {steps.map((s) => (
          <div key={s.key} className="flex flex-1 flex-col items-center gap-1 text-center">
            <span className={`h-2.5 w-2.5 rounded-full ${dotClass(s)}`} />
            <span className="text-[10px] text-muted-foreground">{t(s.labelKey)}</span>
            <span className="text-[9px] text-muted-foreground/70" dir="ltr">
              {fmtTime(s.at)}
            </span>
          </div>
        ))}
      </div>

      {/* Entry type */}
      <div className="mb-2 text-[11px] text-muted-foreground">
        {t(`rec.entry.${rec.entryType}`)}
      </div>

      {/* Levels */}
      <div className="mb-3 divide-y divide-border/50 rounded-lg border border-border/50">
        {rows.map((r) => (
          <div key={r.labelKey} className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs text-muted-foreground">{t(r.labelKey)}</span>
            <span className="flex items-center gap-2">
              <span className={`font-mono text-xs font-semibold ${r.color}`} dir="ltr">
                {r.value}
              </span>
              <CopyPrice value={r.value} />
            </span>
          </div>
        ))}
      </div>

      {/* Smart Tip */}
      <div className="rounded-lg bg-background/60 p-2">
        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {t("rec.tip.title")}
        </p>
        <p className="text-xs text-foreground">{t(smartTipKey(rec))}</p>
      </div>
    </div>
  );
}
