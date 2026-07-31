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
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

type TradeModeState = "auto" | "advisory" | "unset";
type AutoExecutionStage = "off" | "dry_run" | "demo" | "live";

interface TradeModeView {
  mode: TradeModeState;
  stored_mode: TradeModeState;
  connected: boolean;
  needs_choice: boolean;
  downgraded_reason: "connection_lost" | "phase_disabled" | null;
  updated_at: number | null;
  auto_execution_stage?: AutoExecutionStage;
}

const POLL_MS = 7_000;

const BADGE_CLASSES: Record<TradeModeState, string> = {
  auto: "border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  advisory: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  unset: "border-border bg-muted/40 text-muted-foreground",
};

const STAGE_CLASSES: Record<AutoExecutionStage, string> = {
  off: "text-muted-foreground",
  dry_run: "text-slate-600 dark:text-slate-300",
  demo: "text-sky-700 dark:text-sky-300",
  live: "text-emerald-700 dark:text-emerald-300",
};

export function TradeModePanel() {
  const { t, dir } = useLocale();
  const [view, setView] = useState<TradeModeView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/trade-mode", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as TradeModeView;
      if (alive.current) setView(data);
    } catch {
      /* transient — the next poll retries */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    // Polling doubles as the disconnect watcher: the server downgrades auto
    // the moment the debounced EA signal drops, and the next tick shows it.
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [load]);

  const applyMode = useCallback(
    async (mode: "auto" | "advisory") => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/agent/trade-mode", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "auto"
              ? // The dialog's accept button is the only caller with mode=auto,
                // so this flag is literally "the user pressed confirm".
                { mode, confirmed_by_user: true, actor: "platform" }
              : { mode, actor: "platform" },
          ),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? t("trade_mode.error"));
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("trade_mode.error"));
      } finally {
        setSaving(false);
        setConfirming(false);
      }
    },
    [load, t],
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

        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px]",
            view.connected ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400",
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

        {/* The switch exists only while the debounced EA signal is stable. */}
        {showSwitch ? (
          mode === "auto" ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void applyMode("advisory")}
              className="min-h-7 rounded-full border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {t("trade_mode.switch_to_advisory")}
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => setConfirming(true)}
              className="min-h-7 rounded-full border border-emerald-500/45 bg-emerald-500/10 px-2.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
            >
              {t("trade_mode.switch_to_auto")}
            </button>
          )
        ) : null}
      </div>

      {view.downgraded_reason === "connection_lost" && view.stored_mode === "auto" ? (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
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
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          {t("trade_mode.stage.off_note")}
        </p>
      ) : null}
      {autoArmedDryRun ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("trade_mode.stage.dry_run_note")}
        </p>
      ) : null}
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}

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
            className="w-full max-w-md rounded-xl border border-border bg-background p-4 shadow-xl"
          >
            <h3 className="text-sm font-semibold text-foreground">
              {t("trade_mode.confirm.title")}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {t("trade_mode.confirm.body")}
            </p>
            {stage === "off" ? (
              <p className="mt-2 rounded-md border border-amber-500/35 bg-amber-500/[0.08] px-2.5 py-1.5 text-[12px] text-amber-700 dark:text-amber-300">
                {t("trade_mode.stage.off_note")}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirming(false)}
                className="min-h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                {t("trade_mode.confirm.cancel")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void applyMode("auto")}
                className="min-h-9 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
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
