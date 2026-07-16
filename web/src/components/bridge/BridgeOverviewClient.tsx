"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TradeIntent, TradingSettings } from "@/lib/types";
import type { AdminPlatformStats } from "@/lib/store";
import { FadeIn } from "@/components/ui/fade-in";
import { ActiveTradesTable } from "@/components/bridge/ActiveTradesTable";
import { StatusChip, type StatusChipTone } from "@/components/bridge/StatusChip";
import { AgentStatusBar } from "@/components/dashboard/AgentStatusBar";
import { AdminOverview } from "@/components/admin/AdminOverview";
import {
  Wifi,
  WifiOff,
  Zap,
  AlertTriangle,
  MessageSquare,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ConnectionStatus {
  mt5: { connected: boolean; online: boolean };
  telegram: { linked: boolean };
  executionEnv: { label: string; available: boolean };
}

/* ─── Connection status card (Bento-style) ─── */
function ConnBentoCard({
  title,
  chip,
  detail,
  href,
  icon: Icon,
}: {
  title: string;
  chip: { label: string; tone: StatusChipTone };
  detail?: string;
  href?: string;
  icon: React.ElementType;
}) {
  const dotClass =
    chip.tone === "ok"
      ? "status-dot status-dot-ok"
      : chip.tone === "error"
        ? "status-dot status-dot-error"
        : chip.tone === "warn"
          ? "status-dot status-dot-warn"
          : "status-dot status-dot-neutral";

  const inner = (
    <div className="bento-card group h-full cursor-pointer p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06]">
          <Icon className="h-4.5 w-4.5 text-zinc-400" />
        </span>
        <span className={dotClass} />
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-[11px] text-zinc-600 font-medium uppercase tracking-wide">{title}</p>
        <StatusChip label={chip.label} tone={chip.tone} />
        {detail && <p className="text-[10px] text-zinc-600 mt-0.5">{detail}</p>}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}

export function BridgeOverviewClient({
  settings,
  eaConnected,
  eaOnline,
  pendingIntents,
  isAdmin,
  adminStats,
}: {
  settings: TradingSettings;
  eaConnected: boolean;
  eaOnline: boolean;
  pendingIntents: TradeIntent[];
  isAdmin: boolean;
  adminStats?: AdminPlatformStats;
}) {
  const [conn, setConn] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    void fetch("/api/console/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setConn(d as ConnectionStatus))
      .catch(() => {});
  }, []);

  const tgLinked = Boolean(settings.telegram_chat_id);
  const execLabel = conn?.executionEnv.label ?? "فوركس";

  return (
    <FadeIn>
      <div className="space-y-8 max-w-7xl mx-auto">

        {/* ─── Page header ─── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">نظرة عامة</h1>
            <p className="mt-1 text-sm text-zinc-500">
              جسر MCP — اتصالات، مخاطر، وصفقات حية.
            </p>
          </div>
          {/* Live indicator */}
          <div className="flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/5 px-3 py-1.5">
            <span className="status-dot status-dot-ok" />
            <span className="text-xs font-medium text-green-400">مباشر</span>
          </div>
        </div>

        {/* ─── Agent status bar ─── */}
        <AgentStatusBar />

        {/* ─── Connection status — Bento grid ─── */}
        <div>
          <p className="console-section-label mb-3">حالة الاتصالات</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <ConnBentoCard
              title="Claude MCP"
              chip={{ label: "محادثة", tone: "ok" }}
              detail="التداول عبر Connectors"
              href={isAdmin ? "/console/platform?tab=system" : "/console/mcp"}
              icon={MessageSquare}
            />
            <ConnBentoCard
              title="MT5 / EA"
              chip={{
                label: !eaConnected
                  ? "غير مرتبط"
                  : eaOnline
                    ? "متصل"
                    : "غير متصل",
                tone: eaConnected ? (eaOnline ? "ok" : "error") : "neutral",
              }}
              href="/console/connect"
              icon={eaOnline ? Wifi : WifiOff}
            />
            <ConnBentoCard
              title="Telegram"
              chip={{
                label: tgLinked ? "مرتبط" : "غير مرتبط",
                tone: tgLinked ? "ok" : "neutral",
              }}
              href="/console/connect"
              icon={Zap}
            />
            <ConnBentoCard
              title="بيئة التنفيذ"
              chip={{
                label: execLabel,
                tone: conn?.executionEnv.available ? "ok" : "warn",
              }}
              href="/console/connect"
              icon={conn?.executionEnv.available ? Zap : AlertTriangle}
            />
          </div>
        </div>

        {/* ─── Pending intents banner ─── */}
        {pendingIntents.length > 0 && (
          <Link href="/console/trades" className="block">
            <div className="bento-card flex items-center gap-4 p-4 border-amber-500/30 bg-amber-500/5 cursor-pointer">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
                <Clock className="h-5 w-5 text-amber-400" />
              </span>
              <div>
                <p className="font-semibold text-amber-300">
                  {pendingIntents.length === 1
                    ? "صفقة واحدة بانتظار الموافقة"
                    : `${pendingIntents.length} صفقات بانتظار الموافقة`}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Claude MCP أو Telegram — راجع الموافقة.
                </p>
              </div>
            </div>
          </Link>
        )}

        {/* ─── Active trades table ─── */}
        <div>
          <p className="console-section-label mb-3">الصفقات المفتوحة</p>
          <ActiveTradesTable />
        </div>

        {/* ─── Admin stats (admin only) ─── */}
        {isAdmin && adminStats && (
          <div>
            <p className="console-section-label mb-3">إحصائيات المنصة</p>
            <AdminOverview stats={adminStats} embedded />
          </div>
        )}
      </div>
    </FadeIn>
  );
}
