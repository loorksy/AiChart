"use client";

import { createContext, useContext } from "react";

export type ShellMenuContextValue = {
  openMobileMenu: () => void;
  closeMobileMenu: () => void;
  mobileOpen: boolean;
};

const ShellMenuContext = createContext<ShellMenuContextValue | null>(null);

export function ShellMenuProvider({
  value,
  children,
}: {
  value: ShellMenuContextValue;
  children: React.ReactNode;
}) {
  return <ShellMenuContext.Provider value={value}>{children}</ShellMenuContext.Provider>;
}

export function useShellMenu(): ShellMenuContextValue | null {
  return useContext(ShellMenuContext);
}
