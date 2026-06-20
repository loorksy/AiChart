"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Loader2,
  AlertTriangle,
  ChevronDown,
  LineChart,
  BrainCircuit,
} from "lucide-react";
import type { AgentActivity, ActivityStatus } from "@/lib/agentActivity";
import { ShiningText } from "@/components/ui/shining-text";
import { cn } from "@/lib/utils";

function statusRing(status: ActivityStatus): string {
  switch (status) {
    case "done":
      return "bg-emerald-500/15 text-emerald-500 ring-emerald-500/20";
    case "running":
      return "bg-primary/15 text-primary ring-primary/30";
    case "error":
      return "bg-rose-500/15 text-rose-500 ring-rose-500/20";
    default:
      return "bg-muted text-muted-foreground ring-border/50";
  }
}

/**
 * Professional, trading-flavoured "agent thinking" timeline — driven by real
 * SSE activity events. Collapsible, with status icons, tool tags, the platform
 * logo, and a small live-Preview button while the agent works.
 */
export function AgentThinkingTimeline({
  activities,
  onPreview,
}: {
  activities: AgentActivity[];
  onPreview?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (activities.length === 0) return null;

  const running = activities.some((a) => a.status === "running");
  const allDone = activities.every((a) => a.status === "done");
  // The agent's real current step (last running, else last) — drives the shimmer.
  const current =
    [...activities].reverse().find((a) => a.status === "running") ??
    activities[activities.length - 1];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      {/* Header */}
      <div
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex cursor-pointer select-none items-center justify-between px-3 py-2.5 transition-colors",
          open ? "border-b border-border/60 bg-secondary/30" : "hover:bg-secondary/30",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Image src="/logo.png" alt="AiChart" width={18} height={18} className="rounded" />
          {running ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : allDone ? (
            <Check className="h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <BrainCircuit className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {running ? (
            <span className="truncate">
              <ShiningText text={`${current?.label ?? "يفكّر"}…`} />
            </span>
          ) : (
            <span className="text-sm font-semibold text-foreground/90">
              {allDone ? "اكتمل التحليل" : "خطوات الوكيل"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {running && onPreview && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
              className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/20"
            >
              <LineChart className="h-3 w-3" />
              Preview مباشر
            </button>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
        </div>
      </div>

      {/* Timeline */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <ul className="max-h-72 space-y-0 overflow-y-auto p-4">
              {activities.map((a, i) => {
                const isLast = i === activities.length - 1;
                return (
                  <motion.li
                    key={a.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={cn(
                      "relative flex gap-3",
                      a.status === "pending" && "opacity-60",
                    )}
                  >
                    {/* connecting line */}
                    {!isLast && (
                      <span className="absolute right-[11px] top-7 bottom-[-6px] w-px bg-border/60" />
                    )}
                    {/* icon node */}
                    <span
                      className={cn(
                        "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-card",
                        statusRing(a.status),
                      )}
                    >
                      {a.status === "done" ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : a.status === "running" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : a.status === "error" ? (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      )}
                    </span>
                    {/* content */}
                    <div className="min-w-0 flex-1 pb-4">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "text-sm leading-snug",
                            a.status === "running"
                              ? "font-semibold text-foreground"
                              : a.status === "error"
                                ? "font-medium text-rose-500"
                                : "text-foreground/80",
                          )}
                        >
                          {a.label}
                        </span>
                        {a.tool && (
                          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {a.tool}
                          </span>
                        )}
                      </div>
                      {a.detail && (
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          {a.detail}
                        </p>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
