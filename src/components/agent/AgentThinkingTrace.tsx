"use client";

/**
 * Claude-style collapsible run trace.
 *
 * One header line — shimmering while the run is live, a quiet summary once it
 * settles — with the REAL pipeline underneath: every row is an actual stage
 * event from the engine (aggregateStageEvents), never a scripted animation.
 * Collapsed by default on purpose: the answer is the product, the trace is
 * there for whoever wants to look.
 *
 * Two sources, one look:
 *  - live: AgentStageEvent[] streaming over SSE while the run is in flight,
 *    plus the engine's latest activity sentence as the "current" row —
 *    real narration from the specialist that just did the work, never a
 *    script.
 *  - done: the persisted result stages ({ stage, durationMs }) rendered from
 *    the run_stages card after the run completes.
 */
import { useMemo, useState } from "react";
import { Check, ChevronDown, History, Sparkles, TriangleAlert } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import {
  KNOWN_STAGES,
  aggregateStageEvents,
  type AgentStageEvent,
} from "@/lib/agent/stageEvents";


interface TraceRow {
  stage: string;
  status: "running" | "done" | "failed" | "resumed";
  durationMs: number | null;
}

function formatSeconds(ms: number): string {
  return ms >= 100 ? `${(ms / 1000).toFixed(1)}s` : "";
}

function StatusIcon({ status }: { status: TraceRow["status"] }) {
  if (status === "running") {
    return (
      <span
        aria-hidden
        className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-border border-t-foreground/70"
      />
    );
  }
  if (status === "failed") {
    return <TriangleAlert className="h-3 w-3 shrink-0 text-warning" aria-hidden />;
  }
  if (status === "resumed") {
    return <History className="h-3 w-3 shrink-0 text-info" aria-hidden />;
  }
  return <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

function TraceBody({
  rows,
  tickerText,
  thoughts,
}: {
  rows: TraceRow[];
  tickerText?: string | null;
  /** The agent's own reasoning lines (server `thinking` SSE) — each one is
   *  composed from real run evidence at the moment the step happened. */
  thoughts?: readonly string[] | null;
}) {
  const { t } = useLocale();
  return (
    <div className="relative ms-[7px] border-s border-border/70 ps-3.5">
      <div className="flex flex-col gap-0.5 py-1">
        {thoughts?.length ? (
          <div
            className="mb-1 flex flex-col gap-1 pt-0.5"
            data-testid="agent-thinking-lines"
          >
            {thoughts.map((line, i) => (
              <p
                key={`${i}-${line.slice(0, 24)}`}
                className="min-w-0 px-1 text-[12px] leading-relaxed text-muted-foreground"
                style={{ animation: "trace-fade-in 300ms ease-out both" }}
              >
                {line}
              </p>
            ))}
          </div>
        ) : null}
        {rows.map((row, i) => {
          const label = KNOWN_STAGES.has(row.stage)
            ? t(`agent.stage.${row.stage}`)
            : row.stage;
          const time = row.durationMs != null ? formatSeconds(row.durationMs) : "";
          return (
            <div
              key={row.stage}
              className="flex min-h-6 items-center gap-2 rounded-md px-1 text-[12.5px]"
              style={{
                animation: `trace-fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${Math.min(i, 8) * 60}ms both`,
              }}
            >
              <StatusIcon status={row.status} />
              <span
                className={cn(
                  "min-w-0 truncate",
                  row.status === "running"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              {row.status === "resumed" ? (
                <span className="shrink-0 text-[11px] text-muted-foreground/70">
                  {t("agent.stage.resumed")}
                </span>
              ) : null}
              {time ? (
                <span className="ms-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
                  {time}
                </span>
              ) : null}
            </div>
          );
        })}
        {tickerText ? (
          <div
            className="flex min-h-6 items-center gap-2 px-1 text-[12px] italic text-muted-foreground"
            style={{ animation: "trace-fade-in 300ms ease-out both" }}
          >
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground/60" />
            <span className="min-w-0">{tickerText}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TraceShell({
  live,
  headerLabel,
  rows,
  tickerText,
  thoughts,
}: {
  live: boolean;
  headerLabel: string;
  rows: TraceRow[];
  tickerText?: string | null;
  thoughts?: readonly string[] | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1" data-testid="agent-thinking-trace">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="-ms-1.5 flex w-fit max-w-full min-h-8 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors duration-100 hover:bg-muted/60"
      >
        <Sparkles
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            live ? "text-foreground/70" : "text-muted-foreground",
          )}
          aria-hidden
        />
        {live ? (
          <span
            className="min-w-0 truncate bg-clip-text text-[13px] font-medium text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)",
              backgroundSize: "200% 100%",
              animation: "trace-shimmer 1.4s linear infinite",
            }}
          >
            {headerLabel}
          </span>
        ) : (
          <span className="min-w-0 truncate text-[13px] font-medium text-muted-foreground">
            {headerLabel}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-300",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="overflow-hidden">
          <TraceBody rows={rows} tickerText={tickerText} thoughts={thoughts} />
        </div>
      </div>
    </div>
  );
}

/** Live variant: renders the run as it happens from real SSE stage events. */
export function AgentThinkingTraceLive({
  events,
  liveNote,
  thoughts,
}: {
  events: readonly AgentStageEvent[];
  /** The engine's latest visible activity sentence — real work, live. */
  liveNote?: string | null;
  /** The agent's own per-step reasoning lines (`thinking` SSE) — derived
   *  from actual run evidence server-side, never a scripted ticker. */
  thoughts?: readonly string[] | null;
}) {
  const { t } = useLocale();
  const rows = useMemo(() => aggregateStageEvents(events), [events]);
  const runningRow = rows.find((r) => r.status === "running");
  // The header is always a REAL stage: the one running, else the last one
  // recorded. There is no synthetic "thinking" fallback — before any event
  // exists the empty state below renders a bare shimmer instead of a word,
  // because a status the engine never reported is a status we invented.
  const labelFor = (stage: string) =>
    KNOWN_STAGES.has(stage) ? t(`agent.stage.${stage}`) : stage;
  const lastRow = rows[rows.length - 1];
  // The newest thought doubles as the collapsed header when it exists — the
  // agent's own sentence beats a stage NAME as a live status line.
  const latestThought = thoughts?.length ? thoughts[thoughts.length - 1] : null;
  const headerLabel =
    latestThought ??
    (runningRow
      ? labelFor(runningRow.stage)
      : lastRow
        ? labelFor(lastRow.stage)
        : "");
  const tickerText = liveNote?.trim()
    ? liveNote.replace(/[.،…\s]+$/g, "")
    : null;

  // Nothing recorded yet — a bare shimmer line, no empty chevron box.
  if (!rows.length && !tickerText && !thoughts?.length) {
    return (
      <div className="flex min-h-8 items-center gap-2 py-1" data-testid="agent-thinking-trace">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-foreground/70" aria-hidden />
        <span
          aria-hidden
          className="h-3 w-24 rounded-full"
          style={{
            backgroundImage:
              "linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)",
            backgroundSize: "200% 100%",
            animation: "trace-shimmer 1.4s linear infinite",
            opacity: 0.35,
          }}
        />
      </div>
    );
  }

  return (
    <TraceShell
      live
      headerLabel={headerLabel}
      rows={rows}
      tickerText={tickerText}
      thoughts={thoughts}
    />
  );
}

/** Done variant: the persisted stage summary once the run has settled. */
export function AgentThinkingTraceDone({
  stages,
}: {
  stages: readonly { stage: string; durationMs?: number | null }[];
}) {
  const { t } = useLocale();
  if (!stages.length) return null;
  const totalMs = stages.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  const total = totalMs >= 100 ? ` · ${(totalMs / 1000).toFixed(1)}s` : "";
  const rows: TraceRow[] = stages.map((s) => ({
    stage: s.stage,
    status: "done",
    durationMs: s.durationMs ?? null,
  }));

  return (
    <TraceShell
      live={false}
      headerLabel={`${t("agent.trace_done")}${total}`}
      rows={rows}
    />
  );
}
