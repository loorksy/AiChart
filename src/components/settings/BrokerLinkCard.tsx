"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Eye, EyeOff, Unlink } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import { Surface } from "@/components/foundation";
import { MetaTraderMark } from "@/components/settings/MetaTraderMark";
import { useLocale } from "@/hooks/useLocale";
import { notifyBillingChanged } from "@/hooks/useBillingSummary";
import type { TranslationKey } from "@/lib/i18n";

interface BrokerStatus {
  configured: boolean;
  linked: boolean;
  status: "draft" | "configured" | null;
  server: string | null;
  login: string | null;
  /** One-time credits charged when the link succeeds (0 = free). */
  link_cost_credits?: number;
}

function errorKey(code?: string): TranslationKey {
  if (code === "metaapi_balance") return "connect.broker.needs_balance";
  if (code === "metaapi_auth") return "connect.broker.auth_failed";
  if (code === "metaapi_server") return "connect.broker.server_not_found";
  if (code === "metaapi_config") return "connect.broker.not_configured";
  return "connect.broker.error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const fieldClass =
  "h-11 border-border bg-background text-start dark:bg-background";

export function BrokerLinkCard() {
  const { t, dir, locale } = useLocale();
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [server, setServer] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (live = false) => {
    const res = await fetch(
      live ? "/api/integrations/broker?refresh=1" : "/api/integrations/broker",
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as BrokerStatus;
    setStatus(json);
    if (json.server) setServer((current) => current || json.server || "");
    if (json.login) setLogin((current) => current || json.login || "");
    return json;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server, login, password }),
      });
      const json = (await res.json()) as { code?: string };
      if (!res.ok) {
        setError(t(errorKey(json.code)));
        return;
      }
      setPassword("");
      // The one-time link charge just landed — refresh badge and balance.
      notifyBillingChanged();
      let live = await refresh(true);
      for (let i = 0; i < 4 && live?.status === "draft"; i += 1) {
        await sleep(2000);
        live = await refresh(true);
      }
    } catch {
      setError(t("connect.broker.error"));
    } finally {
      setBusy(false);
    }
  }, [login, password, refresh, server, t]);

  const unlink = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/broker", { method: "DELETE" });
      if (!res.ok) {
        setError(t("connect.broker.unlink_error"));
        return;
      }
      await refresh();
    } catch {
      setError(t("connect.broker.unlink_error"));
    } finally {
      setBusy(false);
    }
  }, [refresh, t]);

  if (!status) return null;

  const canSubmit =
    server.trim().length >= 2 &&
    login.trim().length >= 1 &&
    password.length >= 1 &&
    !busy;

  return (
    <Surface padding="lg" className="space-y-5" data-testid="broker-link-card">
      <div className="flex flex-col items-center gap-3 text-center">
        <MetaTraderMark />
        {status.status === "configured" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
            <Check className="h-3.5 w-3.5" aria-hidden />
            {t("connect.broker.configured")}
          </span>
        ) : null}
        <h2 className="sr-only">{t("connect.broker.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("connect.broker.subtitle")}</p>
      </div>

      {status.linked && status.configured ? (
        <div className="mx-auto w-full max-w-md">
          <Button
            type="button"
            size="xl"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => void unlink()}
          >
            <Unlink className="h-4 w-4" aria-hidden />
            {t("connect.broker.unlink")}
          </Button>
        </div>
      ) : null}

      {!status.configured ? (
        <p className="rounded-[var(--radius)] bg-muted/50 px-4 py-3 text-center text-sm text-muted-foreground">
          {t("connect.broker.unconfigured")}
        </p>
      ) : (
        <form
          className="mx-auto w-full max-w-md space-y-3"
          dir={dir}
          lang={locale}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          {/* The form IS the confirmation: the one-time charge is stated
              here, once, and the link button is the only ceremony. */}
          {(status.link_cost_credits ?? 0) > 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="link-cost-line">
              {t("connect.broker.link_cost", {
                credits: String(status.link_cost_credits),
              })}
            </p>
          ) : null}
          <label className="block space-y-1.5 text-start text-sm">
            <span className="font-medium">{t("connect.broker.login")}</span>
            <Input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className={fieldClass}
              dir={dir}
              inputMode="numeric"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label className="block space-y-1.5 text-start text-sm">
            <span className="font-medium">{t("connect.broker.password")}</span>
            <span className="relative block">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${fieldClass} pe-11`}
                dir={dir}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-ring"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={
                  showPassword
                    ? t("connect.broker.hide_password")
                    : t("connect.broker.show_password")
                }
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </button>
            </span>
          </label>
          <label className="block space-y-1.5 text-start text-sm">
            <span className="font-medium">{t("connect.broker.server")}</span>
            <Input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder={t("connect.broker.server_placeholder")}
              className={fieldClass}
              dir={dir}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="xl" className="w-full" disabled={!canSubmit}>
            {t("connect.broker.connect")}
          </Button>
        </form>
      )}
    </Surface>
  );
}
