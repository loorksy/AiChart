"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Check } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import { useLocale } from "@/hooks/useLocale";
import { settingsPath } from "@/lib/settings/paths";

export function McpConnectCard() {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  const mcpUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://aichart.lork.cloud/mcp";
    return `${window.location.origin}/mcp`;
  }, []);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <SurfaceCard className="space-y-4" data-testid="mcp-connect-card">
      <div>
        <h2 className="text-lg font-semibold">{t("connect.mcp.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("connect.mcp.subtitle")}
        </p>
      </div>

      <ol className="list-decimal space-y-3 ps-5 text-sm">
        <li>
          <a
            href="https://claude.ai/customize/connectors"
            className="text-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("connect.mcp.step1")}
          </a>
        </li>
        <li>{t("connect.mcp.step2")}</li>
        <li>
          <span>{t("connect.mcp.step3")}</span>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr">
              {mcpUrl}
            </code>
            <button
              type="button"
              onClick={() => void copyUrl()}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-muted"
              aria-label={t("connect.mcp.step3")}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </li>
        <li>{t("connect.mcp.step4")}</li>
        <li>{t("connect.mcp.step5")}</li>
      </ol>

      <p className="text-sm text-muted-foreground">{t("connect.mcp.note")}</p>
      <p className="text-xs text-muted-foreground">
        {t("connect.mcp.paid_only")}{" "}
        <Link href={settingsPath("profile")} className="text-link">
          {t("settings.manage_account")}
        </Link>
      </p>
    </SurfaceCard>
  );
}
