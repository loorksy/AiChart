"use client";

import { MonitorCog, MoonStar, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/components/ThemeProvider";
import {
  SegmentedControl,
  type SegmentedTone,
} from "@/components/SegmentedControl";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

const OPTIONS: {
  value: ThemePreference;
  icon: typeof Sun;
  labelKey: "settings.theme.system" | "profile.theme.light" | "profile.theme.dark";
}[] = [
  { value: "system", icon: MonitorCog, labelKey: "settings.theme.system" },
  { value: "light", icon: Sun, labelKey: "profile.theme.light" },
  { value: "dark", icon: MoonStar, labelKey: "profile.theme.dark" },
];

/**
 * Canonical theme control: system / light / dark.
 * Wires to the existing next-themes store — never a second source.
 */
export function ThemeToggle({
  collapsed = false,
  className,
  tone = "default",
}: {
  collapsed?: boolean;
  className?: string;
  tone?: SegmentedTone;
}) {
  const { theme, setTheme } = useTheme();
  const { t } = useLocale();
  void collapsed;

  return (
    <div data-testid="theme-toggle" aria-label={t("shell.theme")}>
      <SegmentedControl
        value={theme}
        onChange={setTheme}
        ariaLabel={t("shell.theme")}
        tone={tone}
        className={cn(className)}
        items={OPTIONS.map((item) => {
          const Icon = item.icon;
          return {
            value: item.value,
            label: t(item.labelKey),
            icon: <Icon className="h-4 w-4" aria-hidden />,
          };
        })}
      />
    </div>
  );
}
