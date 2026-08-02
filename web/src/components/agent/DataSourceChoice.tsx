"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Cloud, Database, MonitorSmartphone } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

type Source = "oanda" | "ea" | "metaapi";
type Preference = Source | "auto";

interface DataSourceView {
  active: Source;
  preference: Preference;
  available: { oanda: boolean; ea: boolean; metaapi: boolean };
}

const OPTION_CLASS =
  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent";

const ICONS: Record<Preference, typeof Cloud> = {
  auto: Database,
  metaapi: Cloud,
  ea: MonitorSmartphone,
  oanda: Database,
};

/**
 * Which market the charts are read from.
 *
 * Three pipes can serve the same pair and they are not the same data: the
 * platform's own feed, the trader's terminal over the EA bridge, and their
 * cloud MetaTrader account. The prices a trader's orders fill against come
 * from their broker, so once a broker is linked its feed is the honest default
 * — but a feed that is down, or a broker with a thin history, is a real reason
 * to pin another, and that choice belongs to the operator, not to a config
 * file. Sources that are not connected are shown and disabled rather than
 * hidden, so the menu explains what linking an account would buy.
 */
export function DataSourceChoice({ enabled }: { enabled: boolean }) {
  const { t } = useLocale();
  const [view, setView] = useState<DataSourceView | null>(null);
  const [saving, setSaving] = useState(false);

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
        /* the section simply stays hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, view]);

  const choose = useCallback(async (source: Preference) => {
    setSaving(true);
    try {
      const res = await fetch("/api/market/data-source", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (res.ok) setView((await res.json()) as DataSourceView);
    } finally {
      setSaving(false);
    }
  }, []);

  if (!view) return null;

  const rows: Array<{ key: Preference; label: string; hint: string; usable: boolean }> = [
    {
      key: "auto",
      label: t("data_source.auto"),
      hint: t("data_source.auto_hint"),
      usable: true,
    },
    {
      key: "metaapi",
      label: t("data_source.metaapi"),
      hint: view.available.metaapi
        ? t("data_source.metaapi_hint")
        : t("data_source.needs_link"),
      usable: view.available.metaapi,
    },
    {
      key: "ea",
      label: t("data_source.ea"),
      hint: view.available.ea ? t("data_source.ea_hint") : t("data_source.needs_ea"),
      usable: view.available.ea,
    },
    {
      key: "oanda",
      label: t("data_source.oanda"),
      hint: t("data_source.oanda_hint"),
      usable: true,
    },
  ];

  return (
    <section aria-label={t("data_source.title")} data-testid="composer-data-source">
      <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] font-semibold text-foreground">
        <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {t("data_source.title")}
      </p>
      {rows.map((row) => {
        const Icon = ICONS[row.key];
        const selected = view.preference === row.key;
        return (
          <button
            key={row.key}
            type="button"
            disabled={saving || !row.usable}
            aria-pressed={selected}
            data-source-option={row.key}
            onClick={() => void choose(row.key)}
            className={cn(OPTION_CLASS)}
          >
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className={cn("block text-xs", selected && "font-semibold")}>
                {row.label}
                {/* Which pipe is actually serving right now — `auto` resolves
                    to one of the others, and the operator should see which. */}
                {row.key !== "auto" && view.active === row.key && (
                  <span className="ms-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                    {t("data_source.active")}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                {row.hint}
              </span>
            </span>
            {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
          </button>
        );
      })}
    </section>
  );
}
