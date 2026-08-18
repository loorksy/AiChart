"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import { Surface } from "@/components/foundation";
import { MetaTraderMark } from "@/components/settings/MetaTraderMark";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";

interface BrokerStatus {
  configured: boolean;
  linked: boolean;
  status: "draft" | "configured" | null;
  server: string | null;
  login: string | null;
}

function errorKey(code?: string): TranslationKey {
  if (code === "metaapi_balance") return "connect.broker.needs_balance";
  if (code === "metaapi_auth") return "connect.broker.auth_failed";
  if (code === "metaapi_server") return "connect.broker.server_not_found";
  return "connect.broker.error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function BrokerLinkCard() {
  const { t } = useLocale();
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

  if (!status) return null;

  const canSubmit =
    server.trim().length >= 2 &&
    login.trim().length >= 1 &&
    password.length >= 1 &&
    !busy;

  return (
    <Surface padding="lg" className="space-y-5" data-testid="broker-link-card">
      <div className="flex items-start justify-between gap-3">
        <MetaTraderMark />
        {status.status === "configured" ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
            <Check className="h-3.5 w-3.5" aria-hidden />
            {t("connect.broker.configured")}
          </span>
        ) : status.status === "draft" ? (
          <span className="inline-flex shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            {t("connect.broker.draft")}
          </span>
        ) : null}
      </div>
      <h2 className="sr-only">{t("connect.broker.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("connect.broker.subtitle")}</p>

      {!status.configured ? (
        <p className="rounded-[var(--radius)] bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          {t("connect.broker.unconfigured")}
        </p>
      ) : (
        <form
          className="mx-auto w-full max-w-md space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{t("connect.broker.login")}</span>
            <Input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className="h-11"
              dir="ltr"
              inputMode="numeric"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{t("connect.broker.password")}</span>
            <span className="relative block">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 pe-11"
                dir="ltr"
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
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{t("connect.broker.server")}</span>
            <Input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder={t("connect.broker.server_placeholder")}
              className="h-11"
              dir="ltr"
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
