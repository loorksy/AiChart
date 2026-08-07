"use client";

/**
 * Live run-stage checklist (Phase 3.2) — the structured replacement for
 * watching a single ticker line collapse. One row per pipeline stage: what ran,
 * what is running, what failed, and how long each took. Renders NOTHING when no
 * stage events exist (informational Q&A turns), so it never adds noise.
 *
 * Stage names and durations only — activity messages and evidence render
 * elsewhere; reasoning never renders at all.
 */
import { Check, History, Loader2, TriangleAlert } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import {
  aggregateStageEvents,
  type AgentStageEvent,
} from "@/lib/agent/stageEvents";

/** Stages worth a checklist row, in pipeline order. Unknown names still render. */
const KNOWN_STAGES = new Set([
  "market_data",
  "structure",
  "liquidity",
  "supply_demand",
  "multi_timeframe",
  "news",
  "risk",
  "final_decision",
  "drawing",
  "execution_guard",
  "general",
  "research",
]);

function duration(ms: number | null): string | null {
  if (ms == null || ms < 100) return null;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AgentRunStages({
  events,
  className,
}: {
  events: readonly AgentStageEvent[];
  className?: string;
}) {
  const { t, dir } = useLocale();
  const rows = aggregateStageEvents(events);
  if (!rows.length) return null;

  return (
    <ul
      dir={dir}
      data-testid="agent-run-stages"
      className={cn("space-y-1 text-[11px] leading-4", className)}
    >
      {rows.map((row) => {
        const label = KNOWN_STAGES.has(row.stage)
          ? t(`agent.stage.${row.stage}`)
          : row.stage;
        const time = duration(row.durationMs);
        return (
          <li key={row.stage} className="flex items-center gap-1.5">
            {row.status === "running" ? (
              <Loader2
                className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : row.status === "failed" ? (
              <TriangleAlert className="h-3 w-3 shrink-0 text-warning" aria-hidden />
            ) : row.status === "resumed" ? (
              <History className="h-3 w-3 shrink-0 text-info" aria-hidden />
            ) : (
              <Check className="h-3 w-3 shrink-0 text-buy" aria-hidden />
            )}
            <span
              className={cn(
                row.status === "running"
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {label}
            </span>
            {row.status === "resumed" ? (
              <span className="text-muted-foreground/70">
                {t("agent.stage.resumed")}
              </span>
            ) : null}
            {time ? (
              <span className="ms-auto font-mono text-muted-foreground/70">
                {time}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
