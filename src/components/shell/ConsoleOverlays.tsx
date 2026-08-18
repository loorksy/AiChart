"use client";

import { createContext, useContext } from "react";
import type { SettingsTabId } from "@/components/SettingsClient";

type ConsoleOverlays = {
  /** Navigates to the settings path for that section so the URL names it. */
  openSettings: (tab?: SettingsTabId) => void;
};

const ConsoleOverlaysContext = createContext<ConsoleOverlays>({
  openSettings: () => {},
});

export const ConsoleOverlaysProvider = ConsoleOverlaysContext.Provider;

/**
 * Lets any control inside the shell open settings as a real destination. The
 * account menu is rendered in two places; both call this so the URL, not a
 * floating overlay, is what names the section.
 */
export function useConsoleOverlays(): ConsoleOverlays {
  return useContext(ConsoleOverlaysContext);
}
