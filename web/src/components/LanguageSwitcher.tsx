"use client";

import { useLocale } from "@/hooks/useLocale";
import { APP_LOCALES, toggleLocale, type AppLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LABEL: Record<AppLocale, string> = {
  ar: "العربية",
  en: "English",
};

/** Rail badge: two glyphs at most, so it still reads at 20px wide. */
const SHORT_LABEL: Record<AppLocale, string> = {
  ar: "ع",
  en: "EN",
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export type LanguageSwitcherVariant = "segmented" | "inline" | "row" | "rail";

/**
 * Arabic/English switcher with four presentations of the same control:
 * - `segmented` (default) — compact pill group for dense toolbars.
 * - `inline` — equal-width buttons inside the profile popover.
 * - `row` — the canonical console home: a full-width pair in the sidebar footer,
 *   sized to a 44px touch target on phones and tightened on desktop.
 * - `rail` — a single toggle for the collapsed icon rail, where there is no room
 *   for two options; its accessible name states the language it switches TO.
 *
 * Changing language updates the UI direction immediately and persists it.
 */
export function LanguageSwitcher({
  variant = "segmented",
  className,
}: {
  variant?: LanguageSwitcherVariant;
  className?: string;
}) {
  const { locale, setLocale, t } = useLocale();

  if (variant === "rail") {
    const next = toggleLocale(locale);
    return (
      <button
        type="button"
        data-testid="language-switcher"
        onClick={() => setLocale(next)}
        aria-label={`${t("shell.language")}: ${LABEL[next]}`}
        title={LABEL[next]}
        className={cn(
          "mx-auto flex size-11 items-center justify-center rounded-lg text-[11px] font-semibold text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground lg:size-9",
          FOCUS_RING,
          className,
        )}
      >
        <span aria-hidden>{SHORT_LABEL[locale]}</span>
      </button>
    );
  }

  if (variant === "row") {
    return (
      <div
        data-testid="language-switcher"
        role="radiogroup"
        aria-label={t("shell.language")}
        className={cn(
          "grid grid-cols-2 gap-1 rounded-lg border border-sidebar-border bg-background/60 p-1",
          className,
        )}
      >
        {APP_LOCALES.map((lng) => {
          const active = lng === locale;
          return (
            <button
              key={lng}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(lng)}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-md px-2 text-[11px] font-medium transition-colors duration-150 ease-out lg:min-h-8",
                FOCUS_RING,
                active
                  ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)] shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {LABEL[lng]}
            </button>
          );
        })}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div
        data-testid="language-switcher"
        className={cn("flex gap-1", className)}
        role="radiogroup"
        aria-label={t("profile.select_language")}
      >
        {APP_LOCALES.map((lng) => {
          const active = lng === locale;
          return (
            <button
              key={lng}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(lng)}
              className={cn(
                "min-h-9 flex-1 rounded-md px-2 text-[11px] font-medium transition-colors duration-150 ease-out",
                FOCUS_RING,
                active
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {LABEL[lng]}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-testid="language-switcher"
      className={cn(
        "inline-flex rounded-lg border border-border/60 bg-background p-0.5",
        className,
      )}
      role="radiogroup"
      aria-label={t("profile.select_language")}
    >
      {APP_LOCALES.map((lng) => {
        const active = lng === locale;
        return (
          <button
            key={lng}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setLocale(lng)}
            className={cn(
              "min-h-8 rounded-md px-2.5 text-[11px] font-medium transition-colors duration-150 ease-out",
              FOCUS_RING,
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LABEL[lng]}
          </button>
        );
      })}
    </div>
  );
}
