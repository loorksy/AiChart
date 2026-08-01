"use client";

import type { AgentActivityEvent } from "@/lib/agent/types";

const STATUS_DOT: Record<AgentActivityEvent["status"], string> = {
  started: "bg-info animate-pulse",
  completed: "bg-buy",
  warning: "bg-warning",
  failed: "bg-destructive",
};

/**
 * Agent execution steps — real tool/agent work only. Events flagged
 * `visible: false` or with an empty message are never rendered, and the box
 * disappears entirely when there is no meaningful activity (e.g. a greeting).
 */
export function AgentActivityTimeline({
  events,
  live = false,
}: {
  events: AgentActivityEvent[];
  /** true while the run is in flight (softer heading), false in history. */
  live?: boolean;
}) {
  const visible = events.filter(
    (e) => e.visible !== false && e.message.trim().length > 0,
  );
  if (!visible.length) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 p-2" dir="rtl">
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">
        {live ? "نشاط الوكيل" : "خطوات التنفيذ"}
      </p>
      <ul className="space-y-1">
        {visible.slice(-8).map((event) => (
          <li key={event.id} className="flex items-start gap-2 text-[12px]">
            <span
              className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[event.status]}`}
            />
            <span className="text-foreground/90">{event.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
