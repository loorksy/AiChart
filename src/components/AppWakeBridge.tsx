"use client";

import { useEffect } from "react";
import { startAppWakeBridge } from "@/lib/appWake";

/** Mount once in the root layout so every surface hears online / resume. */
export function AppWakeBridge() {
  useEffect(() => startAppWakeBridge(), []);
  return null;
}
