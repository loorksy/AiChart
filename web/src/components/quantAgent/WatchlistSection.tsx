"use client";

/**
 * Quant Agent Chat's Watchlist section (plan §A7) — tracked symbols with a
 * live price. Reuses the existing symbol catalogue (`SymbolPickerSheet`, the
 * same sheet the composer's `ComposerSymbolPicker` opens) for "add", and the
 * existing batch quote endpoint (`/api/market/forex-price?symbols=...`) for
 * price polling — no new symbol search or price infrastructure.
 *
 * Uses its own local open state for the picker sheet rather than the shared
 * `useSheetSlot("symbolPicker")` coordinator: that slot is meant to keep ONE
 * owner's sheet open app-wide, but this is a second, independent mount of the
 * same sheet component (the composer keeps its own) — sharing the slot would
 * make both mounts render simultaneously whenever either owner opens it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { EmptyState } from "@/components/foundation";
import { PairFlags } from "@/components/agent/CurrencyFlag";
import { SymbolPickerSheet } from "@/components/agent/SymbolPickerSheet";
import { formatPairPrice } from "@/lib/markets/pairQuote";

interface WatchlistItem {
  id: number;
  symbol: string;
  market: string;
  createdAt: number;
}

const QUOTE_POLL_MS = 8_000;

export function WatchlistSection() {
  const { t } = useLocale();
  const [items, setItems] = useState<WatchlistItem[] | null>(null);
  const [quotes, setQuotes] = useState<Record<string, number>>({});
  const [requiresLink, setRequiresLink] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/quant-agent/watchlist", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const json = (await res.json()) as { items?: WatchlistItem[] };
      setItems(json.items ?? []);
    } catch {
      setItems((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const symbolsKey = useMemo(() => (items ?? []).map((i) => i.symbol).join(","), [items]);

  useEffect(() => {
    if (!symbolsKey) {
      setQuotes({});
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/market/forex-price?symbols=${encodeURIComponent(symbolsKey)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as {
          quotes?: { symbol: string; price: number }[];
          requires_link?: boolean;
        };
        if (!alive) return;
        setRequiresLink(Boolean(json.requires_link));
        const map: Record<string, number> = {};
        for (const q of json.quotes ?? []) map[q.symbol] = q.price;
        setQuotes(map);
      } catch {
        /* keep last known quotes */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), QUOTE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [symbolsKey]);

  async function handleAdd(symbol: string) {
    setPickerOpen(false);
    try {
      const res = await fetch("/api/quant-agent/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (res.ok) await load();
    } catch {
      /* best-effort — a stale list catches up on next refresh */
    }
  }

  async function handleRemove(id: number) {
    setBusyId(id);
    setItems((prev) => (prev ?? []).filter((i) => i.id !== id));
    try {
      await fetch(`/api/quant-agent/watchlist/${id}`, { method: "DELETE" });
    } catch {
      /* best-effort — reload restores it if the delete actually failed */
      void load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{t("qa.watchlist.title")}</span>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-label={t("qa.watchlist.add")}
          title={t("qa.watchlist.add")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {requiresLink ? (
        <p className="text-[11px] text-muted-foreground">{t("qa.watchlist.requires_link")}</p>
      ) : null}

      {items == null ? (
        <div className="py-4 text-center text-xs text-muted-foreground">{t("qa.watchlist.loading")}</div>
      ) : items.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Star aria-hidden="true" />}
          title={t("qa.watchlist.empty.title")}
          description={t("qa.watchlist.empty.description")}
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <PairFlags symbol={item.symbol} size={16} />
                <span dir="ltr" className="truncate text-xs font-medium text-foreground">
                  {item.symbol}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span dir="ltr" className="font-mono text-xs tabular-nums text-muted-foreground">
                  {item.symbol in quotes ? formatPairPrice(item.symbol, quotes[item.symbol] ?? null) : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRemove(item.id)}
                  disabled={busyId === item.id}
                  aria-label={t("qa.watchlist.remove")}
                  title={t("qa.watchlist.remove")}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SymbolPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        symbol=""
        brokerConnected={false}
        onSelect={(symbol) => void handleAdd(symbol)}
      />
    </div>
  );
}
