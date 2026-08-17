"use client";

import { useEffect } from "react";
import { startAppWakeBridge } from "@/lib/appWake";
import { startConnectionWatchdog } from "@/lib/connectionWatchdog";

/** Mount once in the root layout so every surface hears online / resume. */
export function AppWakeBridge() {
  useEffect(() => {
    const stopWake = startAppWakeBridge();
    const stopWatch = startConnectionWatchdog();
    return () => {
      stopWake();
      stopWatch();
    };
  }, []);
  return null;
}
