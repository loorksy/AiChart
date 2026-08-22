"use client";

/**
 * The execute button + its modal — the whole platform execution surface.
 *
 * The SERVER decides everything: this renders nothing at all unless
 * /api/execution/context says the account is linked and the plan is
 * executable right now, and every value it shows (suggested size, bounds,
 * levels) came precomputed from the account. The modal IS the confirmation:
 * adjust the lots, press execute, read the number. No warnings, no second
 * screen, no advice.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";

interface ExecutionContextView {
  linked: boolean;
  executable: boolean;
  refusal: string | null;
  suggested_volume: number | null;
  min_volume: number | null;
  max_volume: number | null;
  volume_step: number | null;
  balance: number | null;
  currency: string | null;
  direction: "buy" | "sell" | null;
  symbol: string | null;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
}

interface ExecuteResult {
  ok: boolean;
  code?: string;
  execution?: {
    state: string;
    volume: number;
    executed_price: number | null;
    slippage: number | null;
  } | null;
}

function newIdempotencyKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return `web-${g.crypto.randomUUID()}`;
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stepDecimals(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(6, text.length - dot - 1);
}

export function ExecuteRecommendationButton({
  recommendationId,
}: {
  recommendationId: string | number;
}) {
  const { t } = useLocale();
  const [context, setContext] = useState<ExecutionContextView | null>(null);
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/execution/context?recommendation_id=${encodeURIComponent(String(recommendationId))}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as ExecutionContextView;
        if (alive) setContext(data);
      } catch {
        /* unlinked/unreachable → no button, by design */
      }
    })();
    return () => {
      alive = false;
    };
  }, [recommendationId]);

  const step = context?.volume_step ?? 0.01;
  const decimals = useMemo(() => stepDecimals(step), [step]);

  const openModal = useCallback(() => {
    if (!context?.executable) return;
    setVolume(context.suggested_volume ?? context.min_volume ?? 0.01);
    // One key per modal open: a double-press inside the modal reuses it, so
    // the server sees ONE order however many times the button is hit.
    setIdempotencyKey(newIdempotencyKey());
    setResult(null);
    setOpen(true);
  }, [context]);

  const bump = useCallback(
    (direction: 1 | -1) => {
      setVolume((current) => {
        const min = context?.min_volume ?? step;
        const max = context?.max_volume ?? 1000;
        const next = Number((current + direction * step).toFixed(decimals));
        return Math.min(max, Math.max(min, next));
      });
    },
    [context, step, decimals],
  );

  const execute = useCallback(async () => {
    if (busy || result?.ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/execution/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendation_id: String(recommendationId),
          volume,
          idempotency_key: idempotencyKey,
        }),
      });
      const data = (await res.json()) as ExecuteResult;
      setResult(data);
    } catch {
      setResult({ ok: false, code: "metaapi_error" });
    } finally {
      setBusy(false);
    }
  }, [busy, result, recommendationId, volume, idempotencyKey]);

  // No link, dead plan, already executed: NOTHING renders. Hiding is UI
  // convenience only — the server refuses on its own either way.
  if (!context?.executable) return null;

  const errorKey = (code?: string) => {
    const key = `exec.err.${code ?? "metaapi_error"}`;
    const text = t(key);
    return text === key ? t("exec.err.metaapi_error") : text;
  };

  return (
    <>
      <Button size="xl" className="flex-1" onClick={openModal}>
        <Zap aria-hidden className="h-3.5 w-3.5" />
        {t("exec.button")}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("exec.modal.title")}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {t("exec.modal.title")}
            </h3>

            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-muted/40 p-2">
                <div className="text-muted-foreground">{t("exec.modal.entry")}</div>
                <div className="font-semibold text-foreground">{context.entry ?? "—"}</div>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <div className="text-muted-foreground">{t("exec.modal.stop")}</div>
                <div className="font-semibold text-sell">{context.stop_loss ?? "—"}</div>
              </div>
              <div className="rounded-lg bg-muted/40 p-2">
                <div className="text-muted-foreground">{t("exec.modal.target")}</div>
                <div className="font-semibold text-buy">{context.take_profit ?? "—"}</div>
              </div>
            </div>

            <label className="mb-1 block text-xs text-muted-foreground">
              {t("exec.modal.volume")}
            </label>
            <div className="mb-2 flex items-center gap-2" dir="ltr">
              <Button
                variant="outline"
                size="sm"
                onClick={() => bump(-1)}
                disabled={busy || Boolean(result?.ok)}
                aria-label="-"
              >
                −
              </Button>
              <input
                type="number"
                inputMode="decimal"
                step={step}
                min={context.min_volume ?? undefined}
                max={context.max_volume ?? undefined}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                disabled={busy || Boolean(result?.ok)}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-center text-sm font-semibold text-foreground focus-ring"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => bump(1)}
                disabled={busy || Boolean(result?.ok)}
                aria-label="+"
              >
                +
              </Button>
            </div>
            {context.balance != null && (
              <p className="mb-3 text-[11px] text-muted-foreground">
                {t("exec.modal.balance")}: {context.balance} {context.currency ?? ""}
              </p>
            )}

            {result && (
              <p
                className={`mb-3 text-xs font-medium ${result.ok ? "text-buy" : "text-destructive"}`}
              >
                {result.ok
                  ? result.execution?.executed_price != null
                    ? `${t("exec.done", {
                        direction:
                          context.direction === "sell" ? t("decision.sell") : t("decision.buy"),
                        volume: String(result.execution.volume),
                        price: String(result.execution.executed_price),
                      })}${
                        result.execution.slippage != null
                          ? ` (${t("exec.done.slippage", { slippage: String(result.execution.slippage) })})`
                          : ""
                      }`
                    : t("exec.done.pending_price")
                  : errorKey(result.code)}
              </p>
            )}

            <div className="flex gap-2">
              {!result?.ok && (
                <Button size="xl" className="flex-1" onClick={() => void execute()} disabled={busy}>
                  {busy ? t("exec.modal.executing") : t("exec.modal.execute")}
                </Button>
              )}
              <Button
                variant="outline"
                size="xl"
                className="flex-1"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                {t("exec.modal.close")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
