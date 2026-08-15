"use client";

/**
 * Link the agent to Telegram — the user-facing half of /api/telegram/link.
 *
 * The API (link code, deep link, unlink) survived the platform rebuild but no
 * surface called it anymore, so users had no way to connect the bot. This card
 * restores the flow: request a one-time code, open the bot via deep link (or
 * copy the /start command manually), and poll until the webhook confirms the
 * link. States are honest — when the operator has not configured the bot yet,
 * it says so instead of hiding.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Send, Unlink } from "lucide-react";
import { Button } from "@/components/squareui/button";
import { Surface } from "@/components/foundation";
import { useLocale } from "@/hooks/useLocale";

interface LinkStatus {
  configured: boolean;
  linked: boolean;
  botUsername: string | null;
}

interface LinkCode {
  code: string;
  botUsername: string | null;
  deepLink: string | null;
}

export function TelegramLinkCard() {
  const { t, dir } = useLocale();
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [pending, setPending] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram/link", { cache: "no-store" });
      if (!res.ok) return null;
      const json = (await res.json()) as LinkStatus;
      setStatus(json);
      return json;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While a link code is outstanding, poll until the webhook lands the link.
  useEffect(() => {
    if (!pending) return;
    pollRef.current = setInterval(() => {
      void refresh().then((s) => {
        if (s?.linked) setPending(null);
      });
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pending, refresh]);

  const startLink = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      if (!res.ok) return;
      const json = (await res.json()) as LinkCode;
      setPending(json);
      if (json.deepLink) window.open(json.deepLink, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  }, []);

  const unlink = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "DELETE" });
      if (res.ok) {
        setPending(null);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (!status) return null;

  return (
    <Surface padding="lg" className="space-y-3" data-testid="telegram-link-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Send className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("telegram.link.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("telegram.link.description")}
          </p>
        </div>
        {status.linked ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-buy/15 px-2.5 py-1 text-xs font-semibold text-buy">
            <Check className="h-3.5 w-3.5" aria-hidden />
            {t("telegram.link.linked")}
          </span>
        ) : null}
      </div>

      {!status.configured ? (
        <p className="rounded-[var(--radius)] bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          {t("telegram.link.unconfigured")}
        </p>
      ) : status.linked ? (
        <Button size="xl" variant="outline" disabled={busy} onClick={() => void unlink()}>
          <Unlink className="h-4 w-4" aria-hidden />
          {t("telegram.link.unlink")}
        </Button>
      ) : pending ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("telegram.link.pending_hint")}
          </p>
          <div
            className="flex items-center justify-between gap-2 rounded-[var(--radius)] bg-muted/50 px-4 py-3"
            dir="ltr"
          >
            <code className="text-sm font-semibold tracking-wide">
              /start {pending.code}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(`/start ${pending.code}`)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                  .catch(() => undefined);
              }}
              className="focus-ring rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t("telegram.link.copy")}
            >
              {copied ? (
                <Check className="h-4 w-4 text-buy" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
          {pending.deepLink ? (
            <a
              href={pending.deepLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              dir={dir}
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              {t("telegram.link.open_bot")}
            </a>
          ) : null}
        </div>
      ) : (
        <Button size="xl" disabled={busy} onClick={() => void startLink()}>
          <Send className="h-4 w-4" aria-hidden />
          {t("telegram.link.connect")}
        </Button>
      )}
    </Surface>
  );
}
