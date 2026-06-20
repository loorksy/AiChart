"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TradeIntent, TradingSettings } from "@/lib/types";
import type { AdminPlatformStats } from "@/lib/store";
import { SurfaceCard } from "@/components/ui/shell";
import { FadeIn } from "@/components/ui/fade-in";
import { ActiveTradesTable } from "@/components/bridge/ActiveTradesTable";
import { StatusChip, type StatusChipTone } from "@/components/bridge/StatusChip";
import { AgentStatusBar } from "@/components/dashboard/AgentStatusBar";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { ScalpControl } from "@/components/scalp/ScalpControl";

interface ConnectionStatus {
  binance: { connected: boolean; env: string | null; futuresOk: boolean | null };
  mt5: { connected: boolean; online: boolean };
  telegram: { linked: boolean };
  executionEnv: { label: string; mismatch: boolean };
}

function StatusCard({
  title,
  chip,
  detail,
  href,
}: {
  title: string;
  chip: { label: string; tone: StatusChipTone };
  detail?: string;
  href?: string;
}) {
  const inner = (
    <SurfaceCard padding="sm" className="h-full space-y-2 transition hover:border-primary/30">
      <p className="text-xs text-muted-foreground">{title}</p>
      <StatusChip label={chip.label} tone={chip.tone} />
      {detail && (
        <p className="text-[11px] text-muted-foreground">{detail}</p>
      )}
    </SurfaceCard>
  );
  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

export function BridgeOverviewClient({
  settings,
  hasBinance,
  eaConnected,
  eaOnline,
  pendingIntents,
  isAdmin,
  adminStats,
  masterKill,
}: {
  settings: TradingSettings;
  hasBinance: boolean;
  eaConnected: boolean;
  eaOnline: boolean;
  pendingIntents: TradeIntent[];
  isAdmin: boolean;
  adminStats?: AdminPlatformStats;
  masterKill?: boolean;
}) {
  const [conn, setConn] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    void fetch("/api/console/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setConn(d as ConnectionStatus))
      .catch(() => {});
  }, []);

  const tgLinked = Boolean(settings.telegram_chat_id);
  const execLabel =
    conn?.executionEnv.label ??
    (settings.active_market === "forex" ? "فوركس" : "كريبتو");

  return (
    <FadeIn>
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">نظرة عامة</h2>
        <p className="text-sm text-muted-foreground">
          جسر MCP — اتصالات، مخاطر، وصفقات حية.
        </p>
      </div>

      <AgentStatusBar />

      <ScalpControl />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatusCard
          title="Claude MCP"
          chip={{ label: "محادثة", tone: "ok" }}
          detail="التداول عبر Connectors"
          href={isAdmin ? "/console/platform?tab=system" : "/console/risk"}
        />
        <StatusCard
          title="Binance"
          chip={{
            label: hasBinance
              ? conn?.binance.env === "prod"
                ? "حقيقي"
                : "تجريبي"
              : "غير مرتبط",
            tone: hasBinance
              ? conn?.binance.futuresOk === false
                ? "warn"
                : conn?.binance.futuresOk === true
                  ? "ok"
                  : "neutral"
              : "neutral",
          }}
          detail={
            hasBinance && conn?.binance.futuresOk === false
              ? "Futures غير مفعّل"
              : undefined
          }
          href="/console/connect"
        />
        <StatusCard
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
        />
        <StatusCard
          title="Telegram"
          chip={{
            label: tgLinked ? "مرتبط" : "غير مرتبط",
            tone: tgLinked ? "ok" : "neutral",
          }}
          href="/console/connect"
        />
        <StatusCard
          title="بيئة التنفيذ"
          chip={{
            label: execLabel,
            tone: conn?.executionEnv.mismatch ? "warn" : "ok",
          }}
          href="/console/risk"
        />
      </div>

      {pendingIntents.length > 0 && (
        <Link href="/console/trades" className="block">
          <SurfaceCard className="border-chart-1/40 bg-chart-1/5 transition hover:bg-chart-1/10">
            <p className="font-semibold">
              {pendingIntents.length === 1
                ? "صفقة واحدة بانتظار الموافقة"
                : `${pendingIntents.length} صفقات بانتظار الموافقة`}
            </p>
            <p className="text-xs text-muted-foreground">
              Claude MCP أو Telegram — راجع الموافقة.
            </p>
          </SurfaceCard>
        </Link>
      )}

      <ActiveTradesTable />

      {isAdmin && adminStats && (
        <AdminOverview
          stats={adminStats}
          masterKill={masterKill ?? false}
          embedded
        />
      )}
    </div>
    </FadeIn>
  );
}
