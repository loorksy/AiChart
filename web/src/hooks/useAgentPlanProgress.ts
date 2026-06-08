"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyProgress,
  flattenSubtaskKeys,
  getPlanTemplate,
  type AgentPlanMode,
  type PlanTask,
} from "@/lib/agentPlanSteps";

const STEP_MS = 900;

export function useAgentPlanProgress(mode: AgentPlanMode, active: boolean) {
  const [tasks, setTasks] = useState<PlanTask[]>(() => getPlanTemplate(mode));
  const stepRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!active) {
      stepRef.current = 0;
      setTasks(getPlanTemplate(mode));
      return;
    }

    const template = getPlanTemplate(mode);
    const total = flattenSubtaskKeys(template).length;
    stepRef.current = 0;
    setTasks(applyProgress(template, 0));

    timerRef.current = setInterval(() => {
      stepRef.current += 1;
      const template = getPlanTemplate(mode);
      if (stepRef.current >= total) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setTasks(applyProgress(template, total));
        return;
      }
      setTasks(applyProgress(template, stepRef.current));
    }, STEP_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active, mode]);

  return tasks;
}
