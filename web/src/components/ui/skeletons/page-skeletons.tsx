"use client";

import { SkeletonBlock, SkeletonCircle, SkeletonLine } from "@/components/ui/skeleton";

/* ────────────────────────────────────────────────────────────
   Chat Layout Skeleton
   Mimics: sidebar history list · message bubbles · input bar
   ──────────────────────────────────────────────────────────── */

function SidebarSkeleton() {
  return (
    <div className="hidden w-60 shrink-0 flex-col border-l border-border bg-sidebar lg:flex">
      {/* Brand row */}
      <div className="flex h-16 items-center gap-2 border-b border-border/70 px-4">
        <SkeletonCircle size="sm" />
        <SkeletonLine width="w-20" />
      </div>
      {/* Fake nav items */}
      <div className="flex-1 space-y-2 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
            <SkeletonBlock className="h-4.5 w-4.5 shrink-0 rounded-md" />
            <SkeletonLine width={i % 2 === 0 ? "w-24" : "w-16"} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageRowSkeleton({
  isUser = false,
  lineCount = 2,
}: {
  isUser?: boolean;
  lineCount?: number;
}) {
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <SkeletonBlock className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="max-w-[75%] space-y-2">
        <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
          {Array.from({ length: lineCount }).map((_, i) => (
            <SkeletonLine
              key={i}
              width={i === lineCount - 1 ? "w-3/5" : "w-full"}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChatLayoutSkeleton() {
  return (
    <div className="flex h-dvh min-h-0 flex-1 flex-col overflow-hidden bg-background lg:h-full">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Message area */}
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-5 overflow-hidden px-4 py-6">
            <MessageRowSkeleton lineCount={3} />
            <MessageRowSkeleton isUser lineCount={1} />
            <MessageRowSkeleton lineCount={4} />
            <MessageRowSkeleton isUser lineCount={1} />
            <MessageRowSkeleton lineCount={2} />
          </div>
          {/* Input bar */}
          <div className="border-t border-border/50 bg-card/60 px-4 py-3 backdrop-blur-md">
            <div className="mx-auto max-w-3xl">
              <SkeletonBlock className="h-12 w-full rounded-[1.75rem]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Console / Dashboard Layout Skeleton
   Mimics: user card · metric cards · KPI grid · equity chart
   ──────────────────────────────────────────────────────────── */

function MetricCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 text-center">
      <SkeletonLine width="w-12" className="mx-auto mb-2 h-2.5" />
      <SkeletonBlock className="mx-auto h-7 w-16 rounded-lg" />
    </div>
  );
}

function KpiCardSkeleton() {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <SkeletonLine width="w-16" className="h-2.5" />
        <SkeletonBlock className="h-4 w-4 rounded-md" />
      </div>
      <SkeletonBlock className="h-6 w-20 rounded-lg" />
      <SkeletonLine width="w-14" className="h-2" />
    </div>
  );
}

export function DashboardLayoutSkeleton() {
  return (
    <main className="page-shell max-w-6xl space-y-5">
      {/* Title area */}
      <div>
        <SkeletonLine width="w-28" className="h-6 mb-1" />
        <SkeletonLine width="w-40" className="h-3.5" />
      </div>

      {/* Agent status bar */}
      <SkeletonBlock className="h-14 w-full rounded-2xl" />

      {/* User profile card */}
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
        <SkeletonCircle size="lg" className="rounded-2xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonLine width="w-32" className="h-5" />
          <SkeletonLine width="w-48" className="h-3" />
          <div className="flex gap-2">
            <SkeletonBlock className="h-5 w-14 rounded-full" />
            <SkeletonBlock className="h-5 w-20 rounded-full" />
          </div>
        </div>
      </div>

      {/* 3 metric cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>

      {/* Performance section header */}
      <div className="flex items-center justify-between">
        <div>
          <SkeletonLine width="w-20" className="h-5 mb-1" />
          <SkeletonLine width="w-44" className="h-3" />
        </div>
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonBlock key={i} className="h-7 w-10 rounded-lg" />
          ))}
        </div>
      </div>

      {/* 8 KPI cards */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>

      {/* Equity curve chart placeholder */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <SkeletonLine width="w-40" className="h-4" />
          <SkeletonLine width="w-20" className="h-3" />
        </div>
        <SkeletonBlock className="h-48 w-full rounded-xl" />
      </div>

      {/* Asset distribution chart placeholder */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <SkeletonLine width="w-48" className="h-4" />
        <SkeletonBlock className="h-36 w-full rounded-xl" />
      </div>

      {/* Quick action grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <SkeletonBlock className="h-5 w-5 shrink-0 rounded-md" />
            <div className="space-y-1.5 flex-1">
              <SkeletonLine width="w-24" className="h-3.5" />
              <SkeletonLine width="w-16" className="h-2.5" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────
   Live Chart Preview Skeleton
   Mimics: TradingView wrapper with header toolbar + empty axes
   ──────────────────────────────────────────────────────────── */

export function ChartPreviewSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`flex h-full flex-col border-r border-border bg-card/95 backdrop-blur-sm ${className ?? ""}`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <SkeletonBlock className="h-7 w-28 rounded-md" />
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonBlock key={i} className="h-7 w-8 rounded-md" />
          ))}
        </div>
      </div>
      {/* Chart canvas */}
      <div className="relative flex-1 p-3">
        {/* Y-axis labels */}
        <div className="absolute end-3 top-6 bottom-10 flex flex-col justify-between">
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonLine key={i} width="w-12" className="h-2" />
          ))}
        </div>
        {/* X-axis labels */}
        <div className="absolute start-8 end-16 bottom-3 flex justify-between">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonLine key={i} width="w-8" className="h-2" />
          ))}
        </div>
        {/* Candlestick area (decorative bars) */}
        <div className="absolute inset-6 bottom-10 flex items-end justify-evenly gap-px opacity-60">
          {[40, 55, 35, 65, 50, 70, 45, 60, 38, 72, 52, 48, 62, 42, 58, 68, 44, 56, 36, 66].map(
            (h, i) => (
              <div
                key={i}
                className="w-1.5 animate-pulse rounded-sm bg-muted"
                style={{ height: `${h}%`, animationDelay: `${i * 50}ms` }}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Console Overview Skeleton (admin & user home)
   ──────────────────────────────────────────────────────────── */

export function ConsoleOverviewSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pb-4 pt-16 sm:px-6 sm:pb-6 lg:pt-6">
      <div>
        <SkeletonLine width="w-44" className="h-7 mb-1.5" />
        <SkeletonLine width="w-56" className="h-3.5" />
      </div>

      {/* CTA card */}
      <SkeletonBlock className="h-20 w-full rounded-xl" />

      {/* Status card */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <SkeletonLine width="w-28" className="h-4" />
        <SkeletonLine width="w-40" className="h-3" />
      </div>

      {/* MCP card */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-5 w-5 rounded-md" />
          <SkeletonLine width="w-24" className="h-4" />
        </div>
        <SkeletonLine width="w-64" className="h-3" />
        <SkeletonBlock className="h-10 w-full rounded-lg" />
        <div className="flex gap-2">
          <SkeletonBlock className="h-9 w-24 rounded-full" />
          <SkeletonBlock className="h-9 w-36 rounded-full" />
        </div>
      </div>

      {/* Connections card */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-5 w-5 rounded-md" />
          <SkeletonLine width="w-20" className="h-4" />
        </div>
        <div className="space-y-1.5">
          <SkeletonLine width="w-36" className="h-3" />
          <SkeletonLine width="w-28" className="h-3" />
          <SkeletonLine width="w-32" className="h-3" />
        </div>
        <SkeletonBlock className="h-9 w-32 rounded-full" />
      </div>
    </div>
  );
}
