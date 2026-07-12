"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
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

// --- Locale as an external store (localStorage) read via useSyncExternalStore.
// This is the React-recommended pattern for external, client-only state: it
// avoids set-state-in-effect and hydration mismatches (SSR gets DEFAULT_LOCALE,
// the client swaps in the persisted locale after hydration).
const localeListeners = new Set<() => void>();

function readStoredLocale(): AppLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return isAppLocale(stored) ? stored : DEFAULT_LOCALE;
}

function subscribeLocale(cb: () => void): () => void {
  localeListeners.add(cb);
  if (typeof window !== "undefined") window.addEventListener("storage", cb);
  return () => {
    localeListeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", cb);
  };
}

function writeStoredLocale(next: AppLocale): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  }
  applyLocale(next);
  for (const cb of localeListeners) cb();
}

// `hydrated` flips false → true after hydration with NO setState-in-effect.
const noopSubscribe = () => () => {};

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(
    subscribeLocale,
    readStoredLocale,
    () => DEFAULT_LOCALE,
  );
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  // Keep the <html> dir/lang in sync with the active locale (external DOM
  // update from React state — the intended use of an effect, no setState).
  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: AppLocale) => {
    writeStoredLocale(next);
  }, []);

  const value: LocaleContextValue = {
    locale,
    dir: dirForLocale(locale),
    setLocale,
    toggle: () => setLocale(toggleLocale(locale)),
    t: (key, replacements) => translate(locale, key, replacements),
  };

  return (
    <LocaleContext.Provider value={value}>
      <div className={!hydrated ? "invisible" : ""}>{children}</div>
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
