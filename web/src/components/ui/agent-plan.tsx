"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleDotDashed,
  CircleX,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { PlanStatus, PlanTask } from "@/lib/agentPlanSteps";
import { MessageLoading } from "@/components/ui/message-loading";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<PlanStatus, string> = {
  pending: "قيد الانتظار",
  "in-progress": "جارٍ",
  completed: "مكتمل",
  "need-help": "يحتاج مراجعة",
  failed: "فشل",
};

function StatusIcon({ status, size = "md" }: { status: PlanStatus; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  switch (status) {
    case "completed":
      return <CheckCircle2 className={cn(cls, "text-green-500")} />;
    case "in-progress":
      return <CircleDotDashed className={cn(cls, "text-primary")} />;
    case "need-help":
      return <CircleAlert className={cn(cls, "text-yellow-500")} />;
    case "failed":
      return <CircleX className={cn(cls, "text-destructive")} />;
    default:
      return <Circle className={cn(cls, "text-muted-foreground")} />;
  }
}

function statusBadgeClass(status: PlanStatus) {
  switch (status) {
    case "completed":
      return "bg-green-500/15 text-green-600 dark:text-green-400";
    case "in-progress":
      return "bg-primary/15 text-primary";
    case "need-help":
      return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400";
    case "failed":
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

interface AgentPlanProps {
  tasks: PlanTask[];
  title?: string;
  className?: string;
  defaultExpandedId?: string;
}

export function AgentPlanWithLoading({
  tasks,
  title,
  className,
}: AgentPlanProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 px-1">
        <MessageLoading />
      </div>
      <AgentPlan tasks={tasks} title={title} />
    </div>
  );
}

export default function AgentPlan({
  tasks,
  title = "خطة الوكيل",
  className,
  defaultExpandedId,
}: AgentPlanProps) {
  const firstId = defaultExpandedId ?? tasks[0]?.id ?? "";
  const [expandedTasks, setExpandedTasks] = useState<string[]>(
    firstId ? [firstId] : [],
  );

  const toggleTask = (taskId: string) => {
    setExpandedTasks((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  };

  return (
    <div className={cn("text-foreground w-full", className)}>
      <motion.div
        className="surface-card overflow-hidden rounded-lg border border-border shadow-sm"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="border-b border-border/60 px-4 py-2.5">
          <p className="text-xs font-semibold text-foreground">{title}</p>
        </div>
        <ul className="space-y-0.5 p-3">
          {tasks.map((task) => {
            const isExpanded = expandedTasks.includes(task.id);
            const isCompleted = task.status === "completed";

            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => toggleTask(task.id)}
                  className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right transition-colors hover:bg-muted/50"
                >
                  <StatusIcon status={task.status} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      isCompleted && "text-muted-foreground line-through",
                    )}
                  >
                    {task.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                      statusBadgeClass(task.status),
                    )}
                  >
                    {STATUS_LABEL[task.status]}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                      isExpanded && "rotate-180",
                    )}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {isExpanded && task.subtasks.length > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <ul className="relative mr-2 mb-1 ml-1 space-y-0.5 border-r border-dashed border-muted-foreground/25 pr-4">
                        {task.subtasks.map((sub) => (
                          <li
                            key={sub.id}
                            className="flex items-start gap-2 rounded-md px-2 py-1"
                          >
                            <StatusIcon status={sub.status} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p
                                className={cn(
                                  "text-xs",
                                  sub.status === "completed" &&
                                    "text-muted-foreground line-through",
                                )}
                              >
                                {sub.title}
                              </p>
                              {sub.tools && sub.tools.length > 0 && (
                                <div className="mt-0.5 flex flex-wrap gap-1">
                                  {sub.tools.map((tool) => (
                                    <span
                                      key={tool}
                                      className="rounded bg-secondary/60 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                                    >
                                      {tool}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </motion.div>
    </div>
  );
}
