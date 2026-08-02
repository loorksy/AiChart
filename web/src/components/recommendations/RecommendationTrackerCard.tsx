"use client";

import { useState } from "react";
import { Copy, Check, TrendingDown, TrendingUp } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { smartTipKey } from "@/lib/recommendations/smartTip";
import type {
  TrackedRecommendation,
  TrackedRecommendationStatus,
} from "@/lib/recommendations/types";
import { cn } from "@/lib/utils";

type ExecutionState = NonNullable<TrackedRecommendation["executionState"]>;

/**
 * How each execution state reads. The plan's own three layers are kept apart:
 * the direction never changes, the plan type says how it is entered, and this
 * says whether it can be entered right now.
 */
const EXEC_TONE: Record<ExecutionState, string> = {
  valid_now: "bg-buy/15 text-buy",
  awaiting_activation: "bg-warning/15 text-warning",
  // Amber, not the loss red: an operational blocker is not a verdict on the
  // market, and colouring it like a stop-out would say the idea failed.
  blocked: "bg-warning/10 text-warning/90",
  expired: "bg-muted text-muted-foreground",
  invalidated: "bg-muted text-muted-foreground",
};

/** Records written before `executionState` existed still have to render. */
function deriveExecutionState(rec: TrackedRecommendation): ExecutionState {
  if (rec.executionState) return rec.executionState;
  const terminal: Partial<Record<TrackedRecommendationStatus, ExecutionState>> = {
    expired: "expired",
    invalidated: "invalidated",
    cancelled: "blocked",
  };
  const mapped = terminal[rec.status];
  if (mapped) return mapped;
  const waiting =
    rec.activationClass === "conditional" ||
    (rec.status === "pending_entry" && rec.entryType !== "market");
  return waiting ? "awaiting_activation" : "valid_now";
}

function fmtTime(ms?: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function fmtR(value?: number): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value.toFixed(1)}R`;
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
 * Professional, localized recommendation tracker card:
 * lifecycle bar, entry type, copyable levels, net R, and trigger wording.
 */
export function RecommendationTrackerCard({
  rec,
}: {
  rec: TrackedRecommendation;
}) {
  const { t, dir } = useLocale();

  const execState = deriveExecutionState(rec);
  const waiting = execState === "awaiting_activation";
  // Nothing further will happen to these; the card says so by receding rather
  // than by dropping the numbers, which are still worth reading afterwards.
  const settled = execState === "expired" || execState === "invalidated";
  const entered =
    !waiting && (Boolean(rec.triggeredAt) || rec.entryType === "market");
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
    if (s.tone === "sl") return "bg-sell";
    if (s.tone === "entered") return "bg-warning";
    return "bg-buy";
  };

  const netLabels = [fmtR(rec.netRr), fmtR(rec.netRrTp2), null];
  const rows = [
    { labelKey: "rec.row.entry", value: rec.entry, color: "text-warning", extra: null as string | null },
    { labelKey: "rec.row.stop_loss", value: rec.stopLoss, color: "text-sell", extra: null },
    ...rec.targets.slice(0, 3).map((v, i) => ({
      labelKey: `rec.row.target${i + 1}`,
      value: v,
      color: "text-buy",
      extra: netLabels[i] ?? null,
    })),
  ];

  const isBuy = rec.direction === "buy";
  const DirIcon = isBuy ? TrendingUp : TrendingDown;

  return (
    <div
      dir={dir}
      data-execution-state={execState}
      className={cn(
        "rounded-xl border border-border bg-card p-3 text-sm shadow-none",
        waiting && "border-warning/35 bg-warning/[0.04]",
        settled && "opacity-65",
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground" dir="ltr">
          {rec.symbol} · {rec.interval}
        </span>
        {/*
          Direction carries an arrow as well as its colour and its word: red and
          green alone are the one cue a red/green-blind reader cannot use, and
          this is the line that says which way to trade.
        */}
        <span
          className={cn(
            "flex items-center gap-1 text-xs font-bold",
            settled ? "text-muted-foreground" : isBuy ? "text-buy" : "text-sell",
          )}
        >
          <DirIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {isBuy ? t("decision.buy") : t("decision.sell")}
          {rec.setupType ? ` · ${rec.setupType}` : ""}
        </span>
      </div>

      <div
        className={cn(
          "mb-2 rounded-lg px-2 py-1.5 text-xs font-semibold",
          EXEC_TONE[execState],
        )}
      >
        {t(`rec.exec_state.${execState}`)}
      </div>

      {/* Plan type and the strength of the backing, stated as the grades the
          brain actually reports — never a manufactured confidence percentage. */}
      {(rec.planType || rec.statisticalSupport) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {rec.planType && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t("rec.detail.plan_type")}: {t(`rec.plan_type.${rec.planType}`)}
            </span>
          )}
          {rec.statisticalSupport && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t("rec.support.label")}: {t(`rec.support.${rec.statisticalSupport}`)}
            </span>
          )}
        </div>
      )}

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
        {rec.priceAtCreation != null ? (
          <span className="ms-2" dir="ltr">
            · {t("rec.row.current_price")} {rec.priceAtCreation}
          </span>
        ) : null}
      </div>

      {/* Levels */}
      <div className="mb-3 divide-y divide-border/50 rounded-lg border border-border/50">
        {rows.map((r) => (
          <div key={r.labelKey} className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs text-muted-foreground">
              {t(r.labelKey)}
              {r.extra ? (
                <span className="ms-1 text-[10px] text-muted-foreground/80">
                  ≈ {r.extra}
                </span>
              ) : null}
            </span>
            <span className="flex items-center gap-2">
              <span className={`font-mono text-xs font-semibold ${r.color}`} dir="ltr">
                {r.value}
              </span>
              <CopyPrice value={r.value} />
            </span>
          </div>
        ))}
      </div>

      {rec.triggerCondition ? (
        <p className="mb-2 text-xs text-muted-foreground">{rec.triggerCondition}</p>
      ) : null}

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
