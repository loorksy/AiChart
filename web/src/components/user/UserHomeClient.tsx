"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Download, ExternalLink, Plug, Link2 } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import { CopyField } from "@/components/ui/CopyField";
import { formatWhatsAppDisplay } from "@/lib/phone";
import { formatAccessExpiryLabel } from "@/lib/platformAccess";
import type { PublicUser } from "@/lib/types";
import { displayNameForUser } from "@/lib/displayName";
import { needsMcpCredentials } from "@/lib/userCredentials";

export function UserHomeClient({
  user,
  mcpUrl,
  canDownloadEa,
}: {
  user: PublicUser;
  mcpUrl: string;
  canDownloadEa: boolean;
}) {
  const [conn, setConn] = useState<{
    binance: boolean;
    mt5Online: boolean;
    telegram: boolean;
  } | null>(null);

  useEffect(() => {
    void fetch("/api/console/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setConn({
          binance: Boolean(d.binance?.connected),
          mt5Online: Boolean(d.mt5?.online),
          telegram: Boolean(d.telegram?.linked),
        });
      })
      .catch(() => {});
  }, []);

  const needsCredentials = needsMcpCredentials(user);
  const needsProfile = !user.whatsapp_e164 && user.telegram_id;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">مرحباً، {displayNameForUser(user)}</h1>
        <p className="text-sm text-muted-foreground">لوحة AiChart — Claude MCP</p>
      </div>

      {needsCredentials && (
        <SurfaceCard className="border-amber-500/30 bg-amber-500/5">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <h2 className="font-semibold">أكمل بيانات MCP</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                سجّلت عبر Telegram — أضف بريداً وكلمة مرور لربط Claude.
              </p>
              <Link href="/complete-profile" className="btn btn-primary mt-3 text-sm">
                إكمال البيانات
              </Link>
            </div>
          </div>
        </SurfaceCard>
      )}

      <SurfaceCard>
        <h2 className="font-semibold">حالة الحساب</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {user.status === "active" ? "مفعّل" : user.status} · صلاحية:{" "}
          <span>{formatAccessExpiryLabel(user.access_expires_at)}</span>
        </p>
      </SurfaceCard>

      <SurfaceCard className="space-y-3">
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Claude MCP</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          اربط Claude Connectors بعنوان MCP ثم تداول بمحادثة.
        </p>
        <CopyField value={mcpUrl} label="عنوان MCP" />
        <div className="flex flex-wrap gap-2">
          <Link href="/console/mcp" className="btn btn-primary text-sm">
            دليل الربط
          </Link>
          <a
            href="https://claude.ai/customize/connectors"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary inline-flex gap-1 text-sm"
          >
            Claude Connectors
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </SurfaceCard>

      <SurfaceCard className="space-y-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">الاتصالات</h2>
        </div>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>Binance: {conn?.binance ? "متصل" : "غير مربوط"}</li>
          <li>MT5: {conn?.mt5Online ? "متصل" : "غير متصل"}</li>
          <li>Telegram: {conn?.telegram ? "مرتبط" : "—"}</li>
        </ul>
        <Link href="/console/connect" className="btn btn-secondary text-sm">
          إدارة الاتصالات
        </Link>
      </SurfaceCard>

      {canDownloadEa && (
        <SurfaceCard>
          <h2 className="font-semibold">MetaTrader EA</h2>
          <p className="mt-1 text-sm text-muted-foreground">حمّل AiChartBridge.ex5</p>
          <a href="/api/ea/download" className="btn btn-secondary mt-3 inline-flex gap-2 text-sm" download>
            <Download className="h-4 w-4" />
            تحميل AiChartBridge.ex5
          </a>
        </SurfaceCard>
      )}

      {needsProfile && (
        <SurfaceCard className="border-amber-500/30">
          <h2 className="font-semibold">أكمل ملفك</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            أضف رقم واتساب من{" "}
            <Link href="/console/account" className="text-link">
              حسابي
            </Link>
          </p>
        </SurfaceCard>
      )}

      {user.whatsapp_e164 && (
        <p className="text-xs text-muted-foreground">
          واتساب: {formatWhatsAppDisplay(user.whatsapp_e164)}
        </p>
      )}
    </div>
  );
}
