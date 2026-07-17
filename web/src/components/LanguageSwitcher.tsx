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
  const { locale, setLocale, t } = useLocale();

  if (variant === "inline") {
    return (
      <div className="flex gap-1" role="radiogroup" aria-label={t("profile.select_language")}>
        {APP_LOCALES.map((lng) => {
          const active = lng === locale;
          return (
            <button
              key={lng}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(lng)}
              className={`min-h-9 flex-1 rounded-md px-2 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border"
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

  return (
    <div
      className="inline-flex rounded-lg border border-border/60 bg-background p-0.5"
      role="group"
      aria-label={t("profile.select_language")}
    >
      {APP_LOCALES.map((lng) => {
        const active = lng === locale;
        return (
          <button
            key={lng}
            type="button"
            aria-pressed={active}
            onClick={() => setLocale(lng)}
            className={`min-h-8 rounded-md px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active
                ? "bg-background text-foreground shadow-sm"
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
