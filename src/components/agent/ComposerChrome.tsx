"use client";

import { createContext, useContext, type RefObject } from "react";

export interface ComposerChromeValue {
  /** The writing-field frame the sheets tuck behind. */
  hostRef: RefObject<HTMLDivElement | null>;
  /** The composer form — sheets portal here so they share its stacking context. */
  rootRef: RefObject<HTMLFormElement | null>;
}

const ComposerChromeContext = createContext<ComposerChromeValue | null>(null);

export function ComposerChromeProvider({
  value,
  children,
}: {
  value: ComposerChromeValue;
  children: React.ReactNode;
}) {
  return (
    <ComposerChromeContext.Provider value={value}>
      {children}
    </ComposerChromeContext.Provider>
  );
}

export function useComposerChrome(): ComposerChromeValue | null {
  return useContext(ComposerChromeContext);
}
