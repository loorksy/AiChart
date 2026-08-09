"use client";

import { useEffect, useState } from "react";
import { Cloud, Link2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

interface DataSourceView {
  active: "metaapi";
  reason: string;
  available: { metaapi: boolean };
}

/**
 * Which market the pairs are read from — the user's own linked MetaTrader
 * account, the only pipe. There is no platform feed to fall back to and
 * nothing to pick between, so this is a status chip, not a menu: linked, it
 * names the broker cloud account serving the list; unlinked, it is the link
 * CTA that would make the list live. Sitting beside the catalogue keeps the
 * explanation next to the thing it explains.
 */
export function DataSourceMenuButton({
  enabled,
  onChange,
}: {
  enabled: boolean;
  /** Kept for mount-site compatibility; with one pipe there is no switch to fire it. */
  onChange?: (active: "metaapi") => void;
}) {
  void onChange;
  const { t } = useLocale();
  const [view, setView] = useState<DataSourceView | null>(null);

  useEffect(() => {
    if (!enabled || view) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/market/data-source", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as DataSourceView;
        if (alive) setView(data);
      } catch {
        /* the control simply stays hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, view]);

  if (!view) return null;

  const chipClass = cn(
    "flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-[11px] font-medium transition-colors sm:min-h-10",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "text-muted-foreground hover:bg-muted hover:text-foreground",
  );

  if (!view.available.metaapi) {
    // Unlinked: no data is served in its place — the chip IS the link flow.
    return (
      <a
        href="/console/mt5"
        title={t("data_source.needs_link")}
        aria-label={t("data_source.needs_link")}
        data-testid="data-source-trigger"
        data-active-source="unlinked"
        className={chipClass}
      >
        <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="max-w-[8rem] truncate">{t("data_source.link_cta")}</span>
      </a>
    );
  }

  return (
    <span
      title={t("data_source.metaapi_hint")}
      aria-label={t("data_source.title")}
      data-testid="data-source-trigger"
      data-active-source={view.active}
      className={chipClass}
    >
      <Cloud className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="max-w-[8rem] truncate">{t("data_source.short.metaapi")}</span>
    </span>
  );
}
