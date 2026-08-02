"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TradeModeState = "auto" | "advisory" | "unset";
export type AutoExecutionStage = "off" | "dry_run" | "demo" | "live";

export interface TradeModeView {
  mode: TradeModeState;
  stored_mode: TradeModeState;
  connected: boolean;
  needs_choice: boolean;
  downgraded_reason: "connection_lost" | "phase_disabled" | null;
  updated_at: number | null;
  auto_execution_stage?: AutoExecutionStage;
}

export type ApplyModeResult = { ok: true } | { ok: false; error?: string };

const POLL_MS = 7_000;

/**
 * The one shared trade-mode state, read from GET /api/agent/trade-mode.
 *
 * Two surfaces show it — the panel above the conversation and the composer's
 * options menu — and they must never disagree about whether execution is armed.
 * The hook owns the polling and the one rule that cannot be re-litigated per
 * surface: switching to `auto` always carries `confirmed_by_user`, so there is
 * no code path to standing execution authority that skipped a human's consent.
 *
 * Polling stops when `enabled` is false, so a closed menu costs nothing.
 */
export function useTradeMode({ enabled = true }: { enabled?: boolean } = {}) {
  const [view, setView] = useState<TradeModeView | null>(null);
  const [saving, setSaving] = useState(false);
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
    if (!enabled) return () => {
      alive.current = false;
    };
    void load();
    // Polling doubles as the disconnect watcher: the server downgrades auto
    // the moment the debounced EA signal drops, and the next tick shows it.
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [enabled, load]);

  const applyMode = useCallback(
    async (mode: "auto" | "advisory"): Promise<ApplyModeResult> => {
      setSaving(true);
      try {
        const res = await fetch("/api/agent/trade-mode", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "auto"
              ? // Only a confirmation dialog's accept button reaches this
                // branch, so the flag is literally "the user pressed confirm".
                { mode, confirmed_by_user: true, actor: "platform" }
              : { mode, actor: "platform" },
          ),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          return { ok: false, error: body?.error };
        }
        await load();
        return { ok: true };
      } catch {
        return { ok: false };
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  return { view, saving, applyMode, reload: load };
}
