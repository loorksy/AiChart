"use client";

import { useLocale } from "@/hooks/useLocale";
import { APP_LOCALES, toggleLocale, type AppLocale } from "@/lib/i18n";
import {
  SegmentedControl,
  type SegmentedTone,
} from "@/components/SegmentedControl";
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
 * Arabic/English switcher. The default `segmented` look matches ThemeToggle
 * (sliding layoutId border). Other variants keep the same control on surfaces
 * that already hosted a language toggle — nothing new is added.
 */
export function LanguageSwitcher({
  variant = "segmented",
  className,
  tone = "default",
}: {
  variant?: LanguageSwitcherVariant;
  className?: string;
  tone?: SegmentedTone;
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

  return (
    <SegmentedControl
      testId="language-switcher"
      value={locale}
      onChange={setLocale}
      ariaLabel={t("shell.language")}
      tone={tone}
      className={cn(
        variant === "row" || variant === "inline" ? "w-full justify-stretch" : undefined,
        className,
      )}
      items={APP_LOCALES.map((lng) => ({
        value: lng,
        label: LABEL[lng],
        text: SHORT_LABEL[lng],
      }))}
    />
  );
}
