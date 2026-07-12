"use client";

import { useLocale } from "@/hooks/useLocale";
import { APP_LOCALES, type AppLocale } from "@/lib/i18n";

const LABEL: Record<AppLocale, string> = {
  ar: "العربية",
  en: "English",
};

/**
 * Compact Arabic/English switcher. `variant="segmented"` renders both options
 * as a pill group (for the sidebar top); `variant="inline"` renders a small row
 * of buttons (for the profile menu). Changing language updates the UI direction
 * immediately and persists the preference.
 */
export function LanguageSwitcher({
  variant = "segmented",
}: {
  variant?: "segmented" | "inline";
}) {
  const { locale, setLocale } = useLocale();

  if (variant === "inline") {
    return (
      <div className="flex gap-1" role="radiogroup" aria-label={LABEL[locale]}>
        {APP_LOCALES.map((lng) => {
          const active = lng === locale;
          return (
            <button
              key={lng}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(lng)}
              className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {LABEL[lng]}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="inline-flex rounded-lg border border-border/60 bg-background p-0.5">
      {APP_LOCALES.map((lng) => {
        const active = lng === locale;
        return (
          <button
            key={lng}
            type="button"
            aria-pressed={active}
            onClick={() => setLocale(lng)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {LABEL[lng]}
          </button>
        );
      })}
    </div>
  );
}
