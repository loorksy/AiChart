"use client";

/**
 * Compatibility wrappers around {@link BotStatusBanner} / {@link BotModeBadge}.
 * Prefer those names in new code.
 */
import { useLocale } from "@/hooks/useLocale";
import { BotModeBadge, BotStatusBanner } from "./BotStatusBanner";

export { BotStatusBanner, BotModeBadge };

export function SimulationOnlyBanner({ className }: { className?: string }) {
  const { dir } = useLocale();
  return (
    <div dir={dir}>
      <BotStatusBanner accountType={null} className={className} />
    </div>
  );
}

export function SimulationOnlyBadge({ className }: { className?: string }) {
  const { dir } = useLocale();
  return (
    <span dir={dir} className="inline-flex">
      <BotModeBadge mode="simulation" className={className} />
    </span>
  );
}
