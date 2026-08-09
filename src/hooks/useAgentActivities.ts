"use client";

import { useCallback, useState } from "react";
import type { AgentActivity } from "@/lib/agentActivity";

const MAX_VISIBLE_ACTIVITIES = 24;

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
      return [...prev, activity].slice(-MAX_VISIBLE_ACTIVITIES);
    });
  }, []);

  return { activities, reset, upsert };
}
