"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  Plug,
  Link2,
  CandlestickChart,
  Wifi,
  WifiOff,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { CopyField } from "@/components/ui/CopyField";
import { formatWhatsAppDisplay } from "@/lib/phone";
import { formatAccessExpiryLabel } from "@/lib/platformAccess";
import type { PublicUser } from "@/lib/types";
import { displayNameForUser } from "@/lib/displayName";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { cn } from "@/lib/utils";

/* ─── Small connection status row pill ─── */
function ConnPill({
  label,
  connected,
}: {
  label: string;
  connected: boolean | null;
}) {
  const dotClass =
    connected === true
      ? "status-dot status-dot-ok"
      : connected === false
        ? "status-dot status-dot-neutral"
        : "status-dot status-dot-neutral";

  return (
    <div className="flex items-center gap-2">
      <span className={dotClass} />
      <span className="text-sm text-zinc-400">{label}</span>
      <span
        className={cn(
          "ms-auto text-xs font-medium",
          connected ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {connected === null ? "…" : connected ? "متصل" : "غير مرتبط"}
      </span>
    </div>
  );
}

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
    mt5Online: boolean;
    telegram: boolean;
  } | null>(null);

  useEffect(() => {
    void fetch("/api/console/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setConn({
          mt5Online: Boolean(d.mt5?.online),
          telegram: Boolean(d.telegram?.linked),
        });
      })
      .catch(() => {});
  }, []);

  const needsCredentials = needsMcpCredentials(user);
  const needsProfile = !user.whatsapp_e164 && user.telegram_id;

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-5">

        {/* ─── Hero header ─── */}
        <div className="bento-card relative overflow-hidden p-6">
          {/* Background radial */}
          <div
            className="pointer-events-none absolute inset-0 opacity-15"
            style={{
              background:
                "radial-gradient(ellipse at 10% 50%, rgba(255,255,255,0.15) 0%, transparent 60%)",
            }}
          />
          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-1">
                لوحة Lonora
              </p>
              <h1 className="text-2xl font-bold tracking-tight">
                مرحباً، {displayNameForUser(user)}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Claude MCP — التداول الذكي من الشارت
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5">
              <span className="status-dot status-dot-ok" />
              <span className="text-xs font-medium text-foreground">مباشر</span>
            </div>
          </div>
        </div>

        {/* ─── MCP credentials warning ─── */}
        {needsCredentials && (
          <div className="bento-card border-amber-500/25 bg-amber-500/5 flex gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <h2 className="font-semibold text-amber-300">أكمل بيانات MCP</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                سجّلت عبر Telegram — أضف بريداً وكلمة مرور لربط Claude.
              </p>
              <Link href="/complete-profile" className="btn btn-primary mt-3 text-sm">
                إكمال البيانات
              </Link>
            </div>
          </div>
        )}

        {/* ─── Quick actions row ─── */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/chart"
            className="bento-card group flex flex-col gap-3 p-5 cursor-pointer"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent ring-1 ring-border group-hover:ring-foreground/20 transition-all">
              <CandlestickChart className="h-5 w-5 text-foreground" />
            </span>
            <div>
              <h2 className="font-semibold text-sm">الشارت الذكي</h2>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                تحليل AI، SL/TP، وإدارة الصفقات.
              </p>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </Link>

          <Link
            href="/console/connect"
            className="bento-card group flex flex-col gap-3 p-5 cursor-pointer"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] group-hover:ring-white/[0.12] transition-all">
              <Link2 className="h-5 w-5 text-zinc-400" />
            </span>
            <div>
              <h2 className="font-semibold text-sm">الاتصالات</h2>
              <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                MetaTrader · Telegram
              </p>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-300 transition-colors" />
          </Link>
        </div>

        {/* ─── Account status card ─── */}
        <div className="bento-card p-5 flex items-center gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent border border-border">
            {user.status === "active" ? (
              <CheckCircle2 className="h-5 w-5 text-foreground" />
            ) : (
              <Clock className="h-5 w-5 text-amber-400" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-xs console-section-label mb-0.5">حالة الحساب</p>
            <p className="font-semibold text-sm">
              {user.status === "active" ? "مفعّل" : user.status}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              صلاحية: {formatAccessExpiryLabel(user.access_expires_at)}
            </p>
          </div>
        </div>

        {/* ─── Connection status panel ─── */}
        <div className="bento-card p-5 space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent border border-border">
              {conn?.mt5Online ? (
                <Wifi className="h-4 w-4 text-foreground" />
              ) : (
                <WifiOff className="h-4 w-4 text-muted-foreground" />
              )}
            </span>
            <h2 className="font-semibold text-sm">حالة الاتصالات</h2>
            <Link
              href="/console/connect"
              className="ms-auto text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              إدارة
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <ConnPill label="MT5" connected={conn?.mt5Online ?? null} />
          <ConnPill label="Telegram" connected={conn?.telegram ?? null} />
        </div>

        {/* ─── Claude MCP card ─── */}
        <div className="bento-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent border border-border">
              <Plug className="h-4 w-4 text-foreground" />
            </span>
            <h2 className="font-semibold text-sm">Claude MCP</h2>
          </div>
          <p className="text-sm text-zinc-500 leading-relaxed">
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
              className="btn btn-secondary inline-flex gap-1.5 text-sm"
            >
              Claude Connectors
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* ─── EA download ─── */}
        {canDownloadEa && (
          <div className="bento-card p-5">
            <h2 className="font-semibold text-sm">MetaTrader EA</h2>
            <p className="mt-1 text-xs text-zinc-500">حمّل AiChartBridge.ex5</p>
            <a
              href="/api/ea/download"
              className="btn btn-secondary mt-4 inline-flex gap-2 text-sm"
              download
            >
              <Download className="h-4 w-4" />
              تحميل AiChartBridge.ex5
            </a>
          </div>
        )}

        {/* ─── Complete profile nudge ─── */}
        {needsProfile && (
          <div className="bento-card border-amber-500/20 p-5">
            <h2 className="font-semibold text-sm">أكمل ملفك</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              أضف رقم واتساب من{" "}
              <Link href="/console/account" className="text-foreground font-medium underline">
                حسابي
              </Link>
            </p>
          </div>
        )}

        {/* ─── WhatsApp display ─── */}
        {user.whatsapp_e164 && (
          <p className="text-xs text-zinc-600">
            واتساب: {formatWhatsAppDisplay(user.whatsapp_e164)}
          </p>
        )}
      </div>
    </FadeIn>
  );
}
