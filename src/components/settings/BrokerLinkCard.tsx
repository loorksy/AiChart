"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Check, ExternalLink, Landmark, X } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import { Surface } from "@/components/foundation";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import {
  BROKER_CATALOG,
  type BrokerEnv,
} from "@/lib/brokerLink/brokers";
import { isHostedConfigUrl } from "@/lib/brokerLink/hostedUrl";

interface PublicBroker {
  id: string;
  name: string;
  env: BrokerEnv;
}

interface BrokerStatus {
  configured: boolean;
  linked: boolean;
  status: "draft" | "configured" | null;
  broker: PublicBroker | null;
}

export function BrokerLinkCard() {
  const { t, dir } = useLocale();
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [customServer, setCustomServer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);

  const refresh = useCallback(async (live = false) => {
    const res = await fetch(
      live ? "/api/integrations/broker?refresh=1" : "/api/integrations/broker",
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as BrokerStatus;
    setStatus(json);
    if (json.broker?.id) setPicked(json.broker.id);
    return json;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!hostedUrl) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [hostedUrl, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BROKER_CATALOG;
    return BROKER_CATALOG.filter(
      (broker) =>
        broker.name.toLowerCase().includes(q) ||
        broker.server.toLowerCase().includes(q),
    );
  }, [query]);

  const usingCustom = picked === "custom" || (filtered.length === 0 && customServer.trim().length > 0);
  const canContinue =
    Boolean(picked && picked !== "custom") || customServer.trim().length >= 3;

  const startLink = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const body =
        picked && picked !== "custom"
          ? { brokerId: picked }
          : { server: customServer.trim() };
      const res = await fetch("/api/integrations/broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
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
      setHostedUrl(url);
      await refresh();
    } catch {
      setError(t("connect.broker.error"));
    } finally {
      setBusy(false);
    }
  }, [customServer, picked, refresh, t]);

  const closeModal = useCallback(() => {
    setOpen(false);
    setHostedUrl(null);
    setError(null);
    void refresh(true);
  }, [refresh]);

  const openWindow = useCallback(() => {
    if (!hostedUrl) return;
    window.open(hostedUrl, "lonora-broker-link", "noopener,noreferrer,width=480,height=740");
  }, [hostedUrl]);

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
        <Button
          size="xl"
          onClick={() => {
            setError(null);
            setHostedUrl(null);
            setOpen(true);
          }}
        >
          {t("connect.broker.connect")}
        </Button>
      )}

      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) closeModal();
          else setOpen(true);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-[130] bg-foreground/60 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
          <Dialog.Popup
            dir={dir}
            className="fixed inset-3 z-[131] flex max-h-[min(100dvh-1.5rem,52rem)] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background shadow-lg outline-none sm:inset-auto sm:top-8 sm:bottom-8 sm:m-auto sm:h-[min(90dvh,44rem)] sm:w-[min(100%-2rem,32rem)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <Dialog.Title className="text-base font-semibold">
                  {t("connect.broker.modal.title")}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  {hostedUrl
                    ? t("connect.broker.modal.body")
                    : t("connect.broker.pick")}
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-ring"
                aria-label={t("connect.broker.modal.close")}
              >
                <X className="h-4 w-4" aria-hidden />
              </Dialog.Close>
            </div>

            {hostedUrl ? (
              <iframe
                title={t("connect.broker.modal.title")}
                src={hostedUrl}
                className="min-h-0 w-full flex-1 bg-background"
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("connect.broker.search")}
                  className="h-11"
                />
                <div className="grid gap-2">
                  {filtered.map((broker) => {
                    const selected = picked === broker.id;
                    return (
                      <button
                        key={broker.id}
                        type="button"
                        onClick={() => {
                          setPicked(broker.id);
                          setCustomServer("");
                        }}
                        aria-pressed={selected}
                        className={cn(
                          "flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 text-start text-sm font-medium transition-colors focus-ring",
                          selected
                            ? "border-transparent bg-primary text-primary-foreground"
                            : "border-border bg-background hover:bg-muted",
                        )}
                      >
                        <span>{broker.name}</span>
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            selected
                              ? "text-primary-foreground/80"
                              : "text-muted-foreground",
                          )}
                        >
                          {broker.env === "demo"
                            ? t("connect.broker.env.demo")
                            : t("connect.broker.env.live")}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setPicked("custom")}
                    aria-pressed={usingCustom}
                    className={cn(
                      "flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 text-start text-sm font-medium transition-colors focus-ring",
                      usingCustom
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    {t("connect.broker.other")}
                  </button>
                </div>
                {usingCustom || picked === "custom" ? (
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">{t("connect.broker.server")}</span>
                    <Input
                      value={customServer}
                      onChange={(e) => {
                        setCustomServer(e.target.value);
                        setPicked("custom");
                      }}
                      placeholder="BrokerName-MT5"
                      className="h-11"
                      dir="ltr"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </label>
                ) : null}
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
              {hostedUrl ? (
                <>
                  <Button variant="outline" onClick={openWindow}>
                    <ExternalLink className="h-4 w-4" aria-hidden />
                    {t("connect.broker.modal.open")}
                  </Button>
                  <Button onClick={closeModal}>{t("connect.broker.modal.done")}</Button>
                </>
              ) : (
                <Button
                  size="xl"
                  disabled={!canContinue || busy}
                  onClick={() => void startLink()}
                >
                  {t("connect.broker.continue")}
                </Button>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Surface>
  );
}
