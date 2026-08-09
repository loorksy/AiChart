"use client";

/**
 * The "simulation only" banner. Every bot surface carries it.
 *
 * This is not decoration and it is not a disclaimer bolted on at the end — it
 * is the honest label for what these screens do. A bot in AiChart replays a
 * configuration against historical candles and reports what would have
 * happened. It never places an order, and there is no setting that makes it.
 * The code that would have to change is
 * `lib/quantAgent/bots/brokerPort.ts`, and it throws unconditionally.
 *
 * Rendered with `role="note"` rather than `role="alert"`: this is a permanent
 * property of the feature, not an interruption, and an alert that never goes
 * away trains people to stop reading alerts.
 *
 * Tokens only, logical spacing only — `web/DESIGN.md` §2 and §8. The `info`
 * token, not `warning`: nothing here is wrong or pending, it is simply what
 * the feature is.
 */
import { FlaskConical } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

export function SimulationOnlyBanner({ className }: { className?: string }) {
  const { t, dir } = useLocale();
  return (
    <div
      dir={dir}
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-xl border border-info/40 bg-info/10 p-3",
        className,
      )}
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold text-info">{t("qa.bots.simulation_banner.title")}</p>
        <p className="text-[12px] text-muted-foreground">
          {t("qa.bots.simulation_banner.body")}
        </p>
      </div>
    </div>
  );
}

/** The compact form, for a row or a card header where the full banner is noise. */
export function SimulationOnlyBadge({ className }: { className?: string }) {
  const { t } = useLocale();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info",
        className,
      )}
    >
      <FlaskConical className="h-3 w-3" aria-hidden="true" />
      {t("qa.bots.simulation_badge")}
    </span>
  );
}
