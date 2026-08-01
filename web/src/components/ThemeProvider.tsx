"use client";

import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
} from "next-themes";

export type ThemePreference = "light" | "dark" | "system";

type ResolvedTheme = "light" | "dark";

/**
 * next-themes persists the raw preference string ("light" | "dark" | "system")
 * under storageKey="aichart-theme" — byte-compatible with the values the
 * previous hand-rolled provider wrote to localStorage, so existing users keep
 * their theme. attribute="class" reproduces the `dark` class on <html>, and
 * enableColorScheme (on by default) reproduces root.style.colorScheme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      storageKey="aichart-theme"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

export function useTheme() {
  const { theme, resolvedTheme, setTheme } = useNextTheme();
  return {
    theme: (theme ?? "dark") as ThemePreference,
    // never undefined — consumers index straight into this before hydration
    resolved: (resolvedTheme === "light" ? "light" : "dark") as ResolvedTheme,
    setTheme: setTheme as (theme: ThemePreference) => void,
  };
}
