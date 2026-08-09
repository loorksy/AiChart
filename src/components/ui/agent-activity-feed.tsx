"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  CircleDotDashed,
  CircleX,
} from "lucide-react";
import type { AgentActivity, ActivityStatus } from "@/lib/agentActivity";
import { MessageLoading } from "@/components/ui/message-loading";
import { cn } from "@/lib/utils";

function StatusIcon({ status }: { status: ActivityStatus }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />;
    case "running":
      return <CircleDotDashed className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
    case "error":
      return <CircleX className="h-3.5 w-3.5 shrink-0 text-destructive" />;
    default:
      return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
  }
}

interface AgentActivityFeedProps {
  activities: AgentActivity[];
  title?: string;
  className?: string;
  showLoader?: boolean;
}

export function AgentActivityFeed({
  activities,
  title = "ما يفعله الوكيل الآن",
  className,
  showLoader = true,
}: AgentActivityFeedProps) {
  const hasRunning = activities.some((a) => a.status === "running");

  return (
    <motion.div
      className={cn("surface-card overflow-hidden rounded-xl border border-border", className)}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        {showLoader && hasRunning && <MessageLoading />}
        <p className="text-xs font-semibold text-foreground">{title}</p>
      </div>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto p-2">
        <AnimatePresence initial={false}>
          {activities.map((a) => (
            <motion.li
              key={a.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-right"
            >
              <StatusIcon status={a.status} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-xs leading-snug",
                    a.status === "done" && "text-muted-foreground",
                    a.status === "running" && "font-medium text-foreground",
                  )}
                >
                  {a.label}
                </p>
                {a.detail && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{a.detail}</p>
                )}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </motion.div>
  );
}

export function AgentLoadingDots({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 px-1", className)}>
      <MessageLoading />
    </div>
  );
}
