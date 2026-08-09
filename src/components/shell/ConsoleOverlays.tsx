"use client";

import { createContext, useContext } from "react";
import type { SettingsTabId } from "@/components/SettingsClient";

type ConsoleOverlays = {
  /** Opens settings over the current page instead of navigating to it. */
  openSettings: (tab?: SettingsTabId) => void;
};

const ConsoleOverlaysContext = createContext<ConsoleOverlays>({
  openSettings: () => {},
});

export const ConsoleOverlaysProvider = ConsoleOverlaysContext.Provider;

/**
 * Lets any control inside the shell summon a shell-owned overlay. The account
 * menu is rendered in two places and neither of them should own the modal's
 * lifetime — the shell does, so closing the menu cannot take settings with it.
 */
export function useConsoleOverlays(): ConsoleOverlays {
  return useContext(ConsoleOverlaysContext);
}
