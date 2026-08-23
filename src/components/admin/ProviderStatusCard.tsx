"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, RefreshCw } from "lucide-react";

import { Button } from "@/components/squareui/button";
import { cn } from "@/lib/utils";

/**
 * Per-provider status for the operator.
 *
 * The panel used to answer only "which provider is selected". When one
 * account ran out of credit, the failure read as "the AI is down" with no
 * hint of WHICH account — and the operator topped up the provider that was
 * already working. This shows, per provider: active, key present, and the
 * last real outcome the platform got from it.
 *
 * Operator-facing English by deliberate choice: this panel's Arabic debt is
 * on a shrink-only ratchet, so new strings here are added in English rather
 * than growing it (same precedent as the billing tabs).
 */
interface ProviderStatus {
  id: string;
  label: string;
  active: boolean;
  keyConfigured: boolean;
  keyField: string;
  model: string | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureCode: string | null;
}

function ago(ts: number | null): string {
  if (!ts) return "never";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ProviderStatusCard({ refreshKey }: { refreshKey?: number }) {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/config/providers", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { providers?: ProviderStatus[] };
      setProviders(data.providers ?? []);
    } catch {
      /* a status panel that cannot load must not break the keys page */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!providers) return null;

  return (
    <div
      className="min-w-0 space-y-2 rounded-lg border border-border bg-background p-3"
      data-testid="provider-status"
      dir="ltr"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">Provider status</span>
        <Button
          variant="ghost"
          size="sm"
          className="tap-target h-7 px-2"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh provider status"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
        </Button>
      </div>

      <ul className="space-y-2">
        {providers.map((p) => {
          // A failure only matters while it is the most recent word from that
          // provider — an old error above a newer success is noise.
          const failing =
            p.lastFailureAt != null &&
            (p.lastSuccessAt == null || p.lastFailureAt > p.lastSuccessAt);
          return (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
              data-testid={`provider-status-${p.id}`}
            >
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                {p.keyConfigured ? (
                  <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
                ) : (
                  <Circle className="size-3.5 text-muted-foreground" aria-hidden />
                )}
                {p.label}
              </span>

              {p.active && (
                <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                  ACTIVE
                </span>
              )}

              <span className="text-muted-foreground">
                {p.keyConfigured ? `key set (${p.keyField})` : `no key (${p.keyField})`}
              </span>

              {p.active && p.model && (
                <span className="text-muted-foreground">· model: {p.model}</span>
              )}

              {failing ? (
                <span className="inline-flex items-center gap-1 font-medium text-destructive">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  last failure: {p.lastFailureCode} ({ago(p.lastFailureAt)})
                </span>
              ) : p.lastSuccessAt ? (
                <span className="text-muted-foreground">· last ok {ago(p.lastSuccessAt)}</span>
              ) : (
                <span className="text-muted-foreground">· no calls yet</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
