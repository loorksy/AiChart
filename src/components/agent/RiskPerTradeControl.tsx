"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ComposerPopover } from "@/components/agent/ComposerPopover";
import { RISK_PER_TRADE } from "@/lib/productModel";
import { cn } from "@/lib/utils";

/**
 * Risk per trade, in the composer.
 *
 * It is the only trading setting there is, and it decides how large the next
 * position will be — so burying it behind a settings section meant leaving the
 * conversation to change the one number that governs what happens next. The
 * current figure is the control: it reads as a value, not as an icon.
 */
export function RiskPerTradeControl() {
  const { t } = useLocale();
  const [value, setValue] = useState<number | null>(null);
  const [draft, setDraft] = useState<number>(RISK_PER_TRADE.default);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { settings?: { per_trade_pct?: number } };
        const pct = json.settings?.per_trade_pct;
        if (alive && typeof pct === "number") {
          setValue(pct);
          setDraft(pct);
        }
      } catch {
        /* control stays hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Commits on release, not on every drag frame — one PUT per adjustment. */
  const commit = useCallback(async (next: number) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ per_trade_pct: next }),
      });
      if (res.ok) setValue(next);
    } finally {
      setSaving(false);
    }
  }, []);

  // Nothing sensible to show until the account's own figure has arrived.
  if (value == null) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={t("settings.trading.risk_label")}
        title={t("settings.trading.risk_label")}
        data-testid="composer-risk"
        className={cn(
          "metal-chip shrink-0 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "text-foreground",
        )}
      >
        <span dir="ltr">{value.toFixed(1)}%</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <ComposerPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        title={t("settings.trading.risk_label")}
        labelledBy={labelId}
        testId="composer-risk-menu"
      >
        <div className="px-2.5 py-2">
          <p id={labelId} className="sr-only">
            {t("settings.trading.risk_label")}
          </p>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <output className="text-xl font-semibold tabular-nums" dir="ltr">
              {draft.toFixed(1)}%
            </output>
            <span className="text-[11px] text-muted-foreground">
              {saving ? t("settings.saving") : t("settings.trading.only_setting")}
            </span>
          </div>
          <input
            type="range"
            min={RISK_PER_TRADE.min}
            max={RISK_PER_TRADE.max}
            step={RISK_PER_TRADE.step}
            value={draft}
            autoFocus
            aria-label={t("settings.trading.risk_label")}
            onChange={(event) => setDraft(Number(event.target.value))}
            onPointerUp={() => void commit(draft)}
            onKeyUp={() => void commit(draft)}
            className="h-11 w-full cursor-pointer accent-foreground"
          />
          <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground" dir="ltr">
            <span>{RISK_PER_TRADE.min}%</span>
            <span>{RISK_PER_TRADE.max}%</span>
          </div>
        </div>
      </ComposerPopover>
    </>
  );
}
