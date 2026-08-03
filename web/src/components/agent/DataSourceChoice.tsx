"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Cloud, Database } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

type Source = "oanda" | "metaapi";
type Preference = Source | "auto";

interface DataSourceView {
  active: Source;
  preference: Preference;
  available: { oanda: boolean; metaapi: boolean };
}

const ICONS: Record<Preference, typeof Cloud> = {
  auto: Database,
  metaapi: Cloud,
  oanda: Database,
};

/** Short enough to sit beside a search field without crowding it. */
const SHORT_LABEL: Record<Preference, string> = {
  auto: "data_source.short.auto",
  metaapi: "data_source.short.metaapi",
  oanda: "data_source.short.oanda",
};

/**
 * Which market the pairs are read from, chosen where the pairs are chosen.
 *
 * Two pipes can serve the same symbol and they are not the same data: the
 * platform's own feed, and the trader's cloud MetaTrader account. That choice
 * belongs beside the catalogue it changes — switch it and the list, the
 * prices and the sparklines under it all become the other market's,
 * immediately — not in a settings menu two surfaces away where the effect is
 * invisible.
 *
 * A source that is not connected is shown and disabled with what would
 * connect it, rather than hidden, so the control explains what linking an
 * account would buy.
 */
export function DataSourceMenuButton({
  enabled,
  onChange,
}: {
  enabled: boolean;
  /** Fired after a successful switch so the catalogue can reload. */
  onChange?: (active: Source) => void;
}) {
  const { t } = useLocale();
  const [view, setView] = useState<DataSourceView | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The catalogue panel clips its own overflow, and on a desktop dialog the
  // menu is taller than the space left below the trigger — so it is portalled
  // to the body and positioned against the trigger's box instead of being cut
  // off at the panel's edge.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

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

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = rootRef.current;
      const menu = menuRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = menu?.offsetWidth ?? 320;
      const height = menu?.offsetHeight ?? 240;
      const gutter = 8;
      const below = rect.bottom + 6;
      // Flip above the trigger when the viewport below is too short.
      const top =
        below + height + gutter <= window.innerHeight
          ? below
          : Math.max(gutter, rect.top - height - 6);
      const raw = rect.right - width;
      return setPos({
        top,
        left: Math.max(gutter, Math.min(raw, window.innerWidth - width - gutter)),
      });
    };
    place();
    // Measured once more after the menu has a size to place.
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    const onPointer = (event: MouseEvent) => {
      const node = event.target as Node;
      if (rootRef.current?.contains(node) || menuRef.current?.contains(node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = useCallback(
    async (source: Preference) => {
      setSaving(true);
      try {
        const res = await fetch("/api/market/data-source", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as DataSourceView;
        setView(data);
        setOpen(false);
        onChange?.(data.active);
      } finally {
        setSaving(false);
      }
    },
    [onChange],
  );

  if (!view) return null;

  const rows: Array<{ key: Preference; label: string; hint: string; usable: boolean }> = [
    { key: "auto", label: t("data_source.auto"), hint: t("data_source.auto_hint"), usable: true },
    {
      key: "metaapi",
      label: t("data_source.metaapi"),
      hint: view.available.metaapi ? t("data_source.metaapi_hint") : t("data_source.needs_link"),
      usable: view.available.metaapi,
    },
    { key: "oanda", label: t("data_source.oanda"), hint: t("data_source.oanda_hint"), usable: true },
  ];

  const TriggerIcon = ICONS[view.preference];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("data_source.title")}
        title={t("data_source.title")}
        data-testid="data-source-trigger"
        data-active-source={view.active}
        className={cn(
          "flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-[11px] font-medium transition-colors sm:min-h-10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <TriggerIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="max-w-[6.5rem] truncate">{t(SHORT_LABEL[view.preference])}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </button>

      {open &&
        createPortal(
        <div
          ref={menuRef}
          role="menu"
          data-testid="data-source-menu"
          // Opaque by inline style: the menu sits over a grid of cards, and a
          // token that resolves to a translucent surface would let them through.
          style={{
            backgroundColor: "var(--background)",
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
          }}
          className={cn(
            // Above the catalogue sheet (z-160), never clipped by it.
            "fixed z-[170] w-[min(20rem,calc(100vw-3rem))] overflow-hidden rounded-[var(--radius-lg)] border border-border p-1 shadow-2xl",
            "duration-150 animate-in fade-in zoom-in-95 motion-reduce:animate-none",
          )}
        >
          {rows.map((row) => {
            const Icon = ICONS[row.key];
            const selected = view.preference === row.key;
            return (
              <button
                key={row.key}
                type="button"
                role="menuitem"
                disabled={saving || !row.usable}
                aria-pressed={selected}
                data-source-option={row.key}
                onClick={() => void choose(row.key)}
                className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-xs", selected && "font-semibold")}>
                    {row.label}
                    {/* `Automatic` resolves to one of the others; say which. */}
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
        </div>,
        document.body,
      )}
    </div>
  );
}
