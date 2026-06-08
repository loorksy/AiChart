"use client";

import { useCallback, useState } from "react";
import type { AgentActivity } from "@/lib/agentActivity";

export function useAgentActivities() {
  const [activities, setActivities] = useState<AgentActivity[]>([]);

  const reset = useCallback(() => setActivities([]), []);

  const upsert = useCallback((activity: AgentActivity) => {
    setActivities((prev) => {
      const idx = prev.findIndex((a) => a.id === activity.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = activity;
        return next;
      }
      return [...prev, activity];
    });
  }, []);

  return { activities, reset, upsert };
}
