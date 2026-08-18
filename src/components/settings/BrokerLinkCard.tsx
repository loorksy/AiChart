"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Landmark } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { Surface } from "@/components/foundation";
import { useLocale } from "@/hooks/useLocale";
import { isHostedConfigUrl } from "@/lib/brokerLink/hostedUrl";

interface BrokerStatus {
  configured: boolean;
  linked: boolean;
  status: "draft" | "configured" | null;
}

export function BrokerLinkCard() {
  const { t } = useLocale();
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (live = false) => {
    const res = await fetch(
      live ? "/api/integrations/broker?refresh=1" : "/api/integrations/broker",
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as BrokerStatus;
    setStatus(json);
    return json;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startLink = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/broker", { method: "POST" });
      const json = (await res.json()) as {
        code?: string;
        configurationLink?: string;
      };
      if (!res.ok) {
        setError(
          t(
            json.code === "metaapi_balance"
              ? "connect.broker.needs_balance"
              : "connect.broker.error",
          ),
        );
        return;
      }
      const url = json.configurationLink;
      if (!url || !isHostedConfigUrl(url)) {
        setError(t("connect.broker.error"));
        return;
      }
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        window.location.assign(url);
        return;
      }
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        void refresh(true);
      }, 5000);
      window.setTimeout(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      }, 120_000);
      await refresh();
    } catch {
      setError(t("connect.broker.error"));
    } finally {
      setBusy(false);
    }
  }, [refresh, t]);

  if (!status) return null;

  return (
    <Surface padding="lg" className="space-y-4" data-testid="broker-link-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("connect.broker.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("connect.broker.subtitle")}
          </p>
        </div>
        {status.status === "configured" ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-buy/15 px-2.5 py-1 text-xs font-semibold text-buy">
            <Check className="h-3.5 w-3.5" aria-hidden />
            {t("connect.broker.configured")}
          </span>
        ) : status.status === "draft" ? (
          <span className="inline-flex shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            {t("connect.broker.draft")}
          </span>
        ) : null}
      </div>

      {!status.configured ? (
        <p className="rounded-[var(--radius)] bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          {t("connect.broker.unconfigured")}
        </p>
      ) : (
        <Button size="xl" disabled={busy} onClick={() => void startLink()}>
          {t("connect.broker.connect")}
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Surface>
  );
}
