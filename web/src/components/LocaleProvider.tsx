"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  dirForLocale,
  isAppLocale,
  t as translate,
  toggleLocale,
  type AppLocale,
  type Direction,
} from "@/lib/i18n";

/** Backwards-compatible alias — some callers import `Locale` from here. */
export type Locale = AppLocale;

interface LocaleContextValue {
  locale: AppLocale;
  dir: Direction;
  setLocale: (locale: AppLocale) => void;
  toggle: () => void;
  t: (key: string, replacements?: Record<string, string>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function applyLocale(locale: AppLocale) {
  document.documentElement.dir = dirForLocale(locale);
  document.documentElement.lang = locale;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_LOCALE);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    const initial: AppLocale = isAppLocale(stored) ? stored : DEFAULT_LOCALE;
    setLocaleState(initial);
    applyLocale(initial);
    setMounted(true);
  }, []);

  const setLocale = (next: AppLocale) => {
    setLocaleState(next);
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    applyLocale(next);
  };

  const value: LocaleContextValue = {
    locale,
    dir: dirForLocale(locale),
    setLocale,
    toggle: () => setLocale(toggleLocale(locale)),
    t: (key, replacements) => translate(locale, key, replacements),
  };

  return (
    <LocaleContext.Provider value={value}>
      <div className={!mounted ? "invisible" : ""}>{children}</div>
    </LocaleContext.Provider>
  );
}

const DEFAULT_LOCALE_CTX: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  dir: dirForLocale(DEFAULT_LOCALE),
  setLocale: () => {},
  toggle: () => {},
  t: (key, replacements) => translate(DEFAULT_LOCALE, key, replacements),
};

export function useLocale() {
  const ctx = useContext(LocaleContext);
  // Safe default instead of throwing during SSR edge cases (Next 16 Turbopack).
  return ctx ?? DEFAULT_LOCALE_CTX;
}
