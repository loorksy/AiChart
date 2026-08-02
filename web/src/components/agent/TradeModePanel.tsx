"use client";

/**
 * Operator trade-mode control (docs/UNIFIED_AGENT_PLAN.md §3, Group 9).
 *
 * One shared state with MCP, read from GET /api/agent/trade-mode. Three rules
 * are enforced here on top of the server's own:
 *
 *  - the auto/advisory switch renders ONLY while the EA connection is stable
 *    (the server's debounced `connected` signal); the mode badge stays visible
 *    always, so the operator never has to guess what mode they are in;
 *  - switching to auto ALWAYS goes through an explicit confirmation dialog —
 *    there is no one-click path to standing execution authority;
 *  - on disconnect the UI reflects the server's downgrade to advisory at the
 *    next poll, and NOTHING here ever re-sends `auto` on reconnect. Re-arming
 *    is a fresh human decision, taken through the same dialog.
 */
import { useCallback, useState } from "react";
import { Bot, ChevronDown, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import {
  useTradeMode,
  type AutoExecutionStage,
  type TradeModeState,
} from "@/hooks/useTradeMode";
import { AccountTypeBadge } from "@/components/agent/AccountTypeBadge";
import { cn } from "@/lib/utils";

const BADGE_CLASSES: Record<TradeModeState, string> = {
  auto: "border-buy/45 bg-buy/10 text-buy",
  advisory: "border-info/40 bg-info/10 text-info",
  unset: "border-border bg-muted/40 text-muted-foreground",
};

const STAGE_CLASSES: Record<AutoExecutionStage, string> = {
  off: "text-muted-foreground",
  dry_run: "text-muted-foreground",
  demo: "text-info",
  live: "text-buy",
};

export function TradeModePanel() {
  const { t, dir } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Presentation-only: the panel collapses to its badge row by default and
  // expands on demand. Collapse is CSS display, never unmount — polling,
  // confirmation flow and error state live on regardless.
  const [expanded, setExpanded] = useState(false);

  // Shared with the composer's options menu, so the two surfaces can never
  // disagree about whether execution is armed.
  const { view, saving, applyMode: setTradeMode } = useTradeMode();

  const applyMode = useCallback(
    async (mode: "auto" | "advisory") => {
      setError(null);
      const result = await setTradeMode(mode);
      if (!result.ok) setError(result.error ?? t("trade_mode.error"));
      setConfirming(false);
    },
    [setTradeMode, t],
  );

  if (!view) return null;

  const mode = view.mode;
  const stage = view.auto_execution_stage ?? "off";
  const showSwitch = view.connected && view.downgraded_reason !== "phase_disabled";
  const autoArmedStageOff = mode === "auto" && stage === "off";
  const autoArmedDryRun = mode === "auto" && stage === "dry_run";

  return (
    <div
      dir={dir}
      data-testid="trade-mode-panel"
      className="shrink-0 border-b border-border/60 bg-background/60 px-3 py-2 text-[12px]"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Permanent badge — rendered whatever the connection state. */}
        <span
          data-testid="trade-mode-badge"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold",
            BADGE_CLASSES[mode],
          )}
        >
          <Bot className="h-3.5 w-3.5" aria-hidden />
          {t(`trade_mode.mode.${mode}`)}
        </span>

        {/* Demo or real — the single most consequential fact about the
            account the numbers on this screen belong to. */}
        {view.connected && <AccountTypeBadge type={view.account_type ?? null} />}

        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px]",
            view.connected ? "text-muted-foreground" : "text-warning",
          )}
        >
          {view.connected ? (
            <Wifi className="h-3 w-3" aria-hidden />
          ) : (
            <WifiOff className="h-3 w-3" aria-hidden />
          )}
          {!view.connected ? t("trade_mode.disconnected") : null}
        </span>

        <span className={cn("ms-auto text-[11px]", STAGE_CLASSES[stage])}>
          {t("trade_mode.stage.label")}: {t(`trade_mode.stage.${stage}`)}
        </span>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls="trade-mode-details"
          aria-label={expanded ? t("agent.details_collapse") : t("agent.details_expand")}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-ring tap-target-expand"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-[var(--motion-duration-fast)]",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>

      {/* Expand-on-demand details. CSS collapse only — the tree stays mounted. */}
      <div id="trade-mode-details" className={expanded ? undefined : "hidden"}>
        {/* The switch exists only while the debounced EA signal is stable. */}
        {showSwitch ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {mode === "auto" ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void applyMode("advisory")}
                className="min-h-11 rounded-full border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50 focus-ring sm:min-h-8"
              >
                {t("trade_mode.switch_to_advisory")}
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirming(true)}
                className="min-h-11 rounded-full border border-buy/45 bg-buy/10 px-2.5 text-[11px] font-medium text-buy hover:bg-buy/20 disabled:opacity-50 focus-ring sm:min-h-8"
              >
                {t("trade_mode.switch_to_auto")}
              </button>
            )}
          </div>
        ) : null}

        {view.downgraded_reason === "connection_lost" && view.stored_mode === "auto" ? (
          <p className="mt-1 flex items-start gap-1.5 text-[11px] text-warning">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("trade_mode.downgraded.connection_lost")}
          </p>
        ) : null}
        {view.downgraded_reason === "phase_disabled" ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("trade_mode.downgraded.phase_disabled")}
          </p>
        ) : null}
        {autoArmedStageOff ? (
          <p className="mt-1 text-[11px] text-warning">
            {t("trade_mode.stage.off_note")}
          </p>
        ) : null}
        {autoArmedDryRun ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("trade_mode.stage.dry_run_note")}
          </p>
        ) : null}
        {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
      </div>

      {/* Explicit confirmation — the only path to auto. */}
      {confirming ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("trade_mode.confirm.title")}
        >
          <div
            dir={dir}
            className="motion-scale-in w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-background p-4 elevation-4"
          >
            <h3 className="text-sm font-semibold text-foreground">
              {t("trade_mode.confirm.title")}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {t("trade_mode.confirm.body")}
            </p>
            {stage === "off" ? (
              <p className="mt-2 rounded-md border border-warning/35 bg-warning/[0.08] px-2.5 py-1.5 text-[12px] text-warning">
                {t("trade_mode.stage.off_note")}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirming(false)}
                className="min-h-11 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 focus-ring sm:min-h-9"
              >
                {t("trade_mode.confirm.cancel")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void applyMode("auto")}
                className="min-h-11 rounded-md bg-buy px-3 text-xs font-semibold text-white hover:bg-buy/90 disabled:opacity-50 focus-ring sm:min-h-9"
              >
                {t("trade_mode.confirm.accept")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
