"use client";

import type { AgentActivityEvent } from "@/lib/agent/types";

const STATUS_DOT: Record<AgentActivityEvent["status"], string> = {
  started: "bg-blue-500 animate-pulse",
  completed: "bg-emerald-500",
  warning: "bg-amber-500",
  failed: "bg-red-500",
};

/** Live "what the agent is doing now" stream — public activity only. */
export function AgentActivityTimeline({
  events,
}: {
  events: AgentActivityEvent[];
}) {
  if (!events.length) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 p-2" dir="rtl">
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">
        ماذا يفعل الوكيل الآن
      </p>
      <ul className="space-y-1">
        {events.slice(-8).map((event) => (
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
