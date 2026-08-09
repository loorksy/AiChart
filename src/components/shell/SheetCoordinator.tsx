"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Every full-bleed overlay surface in the console that can be summoned from a
 * different corner of the UI than the one it covers.
 */
export type SheetId = "sidebarDrawer" | "profileMenu" | "chart" | "symbolPicker";

type SheetCoordinator = {
  activeSheet: SheetId | null;
  openSheet: (id: SheetId) => void;
  closeSheet: (id: SheetId) => void;
};

const NOOP: SheetCoordinator = {
  activeSheet: null,
  openSheet: () => {},
  closeSheet: () => {},
};

const SheetCoordinatorContext = createContext<SheetCoordinator>(NOOP);

/**
 * One overlay at a time, app-wide.
 *
 * The chart sheet is summoned from the composer, the profile sheet from the
 * sidebar footer, the nav drawer from the page toolbar — three owners that
 * cannot see each other's state. Left alone they stack, and the user gets two
 * backdrops and no way to tell which one a tap will dismiss.
 *
 * A single slot fixes that by construction rather than by convention: each
 * surface is open only while it *is* `activeSheet`, so opening one closes
 * whatever was there. Switching reads as a swap, never as a stack.
 */
export function SheetCoordinatorProvider({ children }: { children: React.ReactNode }) {
  const [activeSheet, setActiveSheet] = useState<SheetId | null>(null);

  const openSheet = useCallback((id: SheetId) => setActiveSheet(id), []);
  // Guarded so a late close from a surface that already lost the slot cannot
  // dismiss whichever one took it over.
  const closeSheet = useCallback(
    (id: SheetId) => setActiveSheet((current) => (current === id ? null : current)),
    [],
  );

  const value = useMemo(
    () => ({ activeSheet, openSheet, closeSheet }),
    [activeSheet, openSheet, closeSheet],
  );

  return (
    <SheetCoordinatorContext.Provider value={value}>
      {children}
    </SheetCoordinatorContext.Provider>
  );
}

/** Returns `[isOpen, setOpen]` for one surface, mutually exclusive with the rest. */
export function useSheetSlot(id: SheetId): [boolean, (open: boolean) => void] {
  const { activeSheet, openSheet, closeSheet } = useContext(SheetCoordinatorContext);
  const setOpen = useCallback(
    (open: boolean) => (open ? openSheet(id) : closeSheet(id)),
    [id, openSheet, closeSheet],
  );
  return [activeSheet === id, setOpen];
}
