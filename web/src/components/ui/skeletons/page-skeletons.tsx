"use client";

import { SkeletonBlock, SkeletonCircle, SkeletonLine } from "@/components/ui/skeleton";

/* ────────────────────────────────────────────────────────────
   Chat Layout Skeleton
   Mimics: sidebar history list · message bubbles · input bar
   ──────────────────────────────────────────────────────────── */

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
   Workspace Skeleton — chart pane + chat pane side by side.
   This is what /console actually renders for a subscribed trader
   (SmartChartWorkspace), so its loading state must look like the
   workspace, not like a metrics dashboard.
   ──────────────────────────────────────────────────────────── */

export function WorkspaceSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <ChartPreviewSkeleton className="hidden min-w-0 flex-1 xl:flex" />
      {/* Chat pane: header, a couple of turns, composer */}
      <div className="flex min-h-0 w-full flex-col xl:w-[26rem] xl:shrink-0">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
          <SkeletonCircle size="sm" />
          <SkeletonLine width="w-24" className="h-3.5" />
        </div>
        <div className="flex-1 space-y-4 overflow-hidden px-3 py-4">
          <MessageRowSkeleton lineCount={2} />
          <MessageRowSkeleton isUser lineCount={1} />
          <MessageRowSkeleton lineCount={3} />
        </div>
        <div className="px-3 pb-3">
          <SkeletonBlock className="h-11 w-full rounded-3xl" />
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Generic building blocks reused by page-level loading states.
   ──────────────────────────────────────────────────────────── */

/** Page header: title + subtitle, optional trailing action. */
export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1.5">
        <SkeletonLine width="w-40" className="h-6" />
        <SkeletonLine width="w-56" className="h-3.5" />
      </div>
      {withAction && <SkeletonBlock className="h-9 w-28 rounded-lg" />}
    </div>
  );
}

/** A bordered card with a heading and a few body lines. */
export function CardSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-3 rounded-xl border border-border bg-card p-4 ${className ?? ""}`}>
      <SkeletonLine width="w-32" className="h-4" />
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine key={i} width={i === lines - 1 ? "w-2/3" : "w-full"} className="h-3" />
        ))}
      </div>
    </div>
  );
}

/** Compact list row: leading icon, two text lines, trailing pill. */
export function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <SkeletonBlock className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="flex-1 space-y-1.5">
        <SkeletonLine width="w-32" className="h-3.5" />
        <SkeletonLine width="w-20" className="h-2.5" />
      </div>
      <SkeletonBlock className="h-6 w-16 rounded-md" />
    </div>
  );
}

/** Row of stat tiles (label + value). */
export function StatTilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-3">
          <SkeletonLine width="w-16" className="mb-2 h-2.5" />
          <SkeletonBlock className="h-6 w-20 rounded-lg" />
        </div>
      ))}
    </div>
  );
}
