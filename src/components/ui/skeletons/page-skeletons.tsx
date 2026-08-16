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

/**
 * Home /chat with no conversation: logo, greeting, composer.
 * Must not look like a thread — that remnant was the old loading state.
 */
export function HomeChatSkeleton() {
  return (
    <div
      data-testid="home-chat-skeleton"
      className="flex h-dvh min-h-0 flex-1 flex-col overflow-hidden bg-background lg:h-full"
    >
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center gap-6 px-3">
        <SkeletonCircle size="lg" className="h-11 w-11" />
        <div className="w-full space-y-2">
          <SkeletonLine width="w-3/4 sm:w-1/2" className="mx-auto h-7" />
          <SkeletonLine width="w-1/2 sm:w-1/3" className="mx-auto h-4" />
        </div>
        <div className="w-full">
          <ComposerSkeleton />
        </div>
      </div>
    </div>
  );
}

/**
 * Opening a saved chat: thread bubbles + docked composer.
 * Keep this when entering chat history — do not replace it with the home hero.
 */
export function ChatLayoutSkeleton() {
  return (
    <div
      data-testid="chat-history-skeleton"
      className="flex h-dvh min-h-0 flex-1 flex-col overflow-hidden bg-background lg:h-full"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-5 overflow-hidden px-4 py-6">
            <MessageRowSkeleton lineCount={3} />
            <MessageRowSkeleton isUser lineCount={1} />
            <MessageRowSkeleton lineCount={4} />
            <MessageRowSkeleton isUser lineCount={1} />
            <MessageRowSkeleton lineCount={2} />
          </div>
          <div className="px-3 pt-1 pb-[max(.5rem,env(safe-area-inset-bottom))]">
            <ComposerSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Live Chart Preview Skeleton
   Mimics: TradingView pane (no library header/footer chrome) + empty axes
   ──────────────────────────────────────────────────────────── */

function ComposerSkeleton() {
  return (
    <div className="chat-gpt-input mx-auto flex w-full max-w-3xl flex-col gap-1 px-2 py-1.5">
      <SkeletonBlock className="h-9 w-full rounded-lg" />
      <div className="flex items-center gap-1">
        <SkeletonBlock className="h-8 w-24 rounded-full" />
        <SkeletonBlock className="h-8 w-14 rounded-lg" />
        <SkeletonBlock className="h-8 w-12 rounded-lg" />
        <SkeletonBlock className="ms-auto size-9 shrink-0 rounded-full" />
      </div>
    </div>
  );
}

function ChartPreviewSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`flex h-full flex-col border-r border-border bg-card/95 backdrop-blur-sm ${className ?? ""}`}
    >
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
          <ComposerSkeleton />
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
function ListRowSkeleton() {
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

/* ────────────────────────────────────────────────────────────
   Shapes the rest of the product is built from.

   Every one of these is fluid by construction — no fixed pixel
   widths on containers, grids that collapse by breakpoint, and
   logical spacing — so the same skeleton describes the page at
   360px and at 1920px, in either writing direction.
   ──────────────────────────────────────────────────────────── */

/** A table: header strip then rows. Collapses to stacked rows on phones. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div
      data-testid="skeleton-table"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="hidden gap-3 border-b border-border px-4 py-3 sm:flex">
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonLine key={i} width="w-full" className="h-3" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
            {Array.from({ length: columns }).map((_, c) => (
              <SkeletonLine
                key={c}
                width={c === 0 ? "w-2/5 sm:w-full" : "w-1/3 sm:w-full"}
                className="h-3"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A form: labelled fields and a submit row. */
export function FormSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <div data-testid="skeleton-form" className="space-y-4 rounded-xl border border-border bg-card p-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <SkeletonLine width="w-24" className="h-3" />
          <SkeletonBlock className="h-11 w-full rounded-lg" />
        </div>
      ))}
      <SkeletonBlock className="h-11 w-full rounded-lg sm:w-40" />
    </div>
  );
}

/** A row of tabs above its panel. */
function TabsSkeleton({ tabs = 4 }: { tabs?: number }) {
  return (
    <div data-testid="skeleton-tabs" className="flex flex-wrap gap-2">
      {Array.from({ length: tabs }).map((_, i) => (
        <SkeletonBlock key={i} className="h-9 w-24 rounded-full" />
      ))}
    </div>
  );
}

/** A vertical list of navigation/history rows (sidebars, drawers). */
export function SidebarListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div data-testid="skeleton-sidebar-list" className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-2">
          <SkeletonBlock className="h-4 w-4 shrink-0 rounded" />
          <SkeletonLine width={i % 3 === 0 ? "w-2/3" : "w-full"} className="h-3" />
        </div>
      ))}
    </div>
  );
}

/** Long-form content: title, lead, paragraphs (docs, blog, legal pages). */
export function ArticleSkeleton({ paragraphs = 4 }: { paragraphs?: number }) {
  return (
    <div data-testid="skeleton-article" className="space-y-6">
      <div className="space-y-2">
        <SkeletonLine width="w-3/4 sm:w-1/2" className="h-7" />
        <SkeletonLine width="w-1/2 sm:w-1/3" className="h-3.5" />
      </div>
      {Array.from({ length: paragraphs }).map((_, p) => (
        <div key={p} className="space-y-2">
          {Array.from({ length: 4 }).map((_, l) => (
            <SkeletonLine key={l} width={l === 3 ? "w-2/3" : "w-full"} className="h-3" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A centred authentication card (sign in, sign up, approval, checkout). */
export function AuthFormSkeleton() {
  return (
    <div
      data-testid="skeleton-auth"
      className="flex min-h-dvh items-center justify-center bg-background p-4"
    >
      <div className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-3">
          <SkeletonCircle size="lg" />
          <SkeletonLine width="w-40" className="h-5" />
          <SkeletonLine width="w-56" className="h-3" />
        </div>
        <FormSkeleton fields={2} />
        <SkeletonLine width="w-2/3" className="mx-auto h-3" />
      </div>
    </div>
  );
}

/**
 * The standard console page: header, optional tiles, then its content.
 * `shape` picks what the body looks like so a route's skeleton describes
 * that route rather than a generic grey rectangle.
 */
export function ConsolePageSkeleton({
  shape = "cards",
  withTiles = false,
  withTabs = false,
  maxWidth = "max-w-5xl",
}: {
  shape?: "cards" | "table" | "form" | "rows" | "article";
  withTiles?: boolean;
  withTabs?: boolean;
  maxWidth?: string;
}) {
  return (
    <main className={`page-shell ${maxWidth} space-y-5`} data-testid="skeleton-page">
      <PageHeaderSkeleton withAction={shape === "table"} />
      {withTabs && <TabsSkeleton />}
      {withTiles && <StatTilesSkeleton />}
      {shape === "table" && <TableSkeleton />}
      {shape === "form" && <FormSkeleton />}
      {shape === "article" && <ArticleSkeleton />}
      {shape === "rows" && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <ListRowSkeleton key={i} />
          ))}
        </div>
      )}
      {shape === "cards" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} lines={3} />
          ))}
        </div>
      )}
    </main>
  );
}

/**
 * A marketing/landing page: hero, feature grid, closing band. Used by the
 * public routes, which are the first thing a cold visitor waits on.
 */
export function MarketingPageSkeleton() {
  return (
    <div data-testid="skeleton-marketing" className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-10 sm:px-6 sm:py-16">
        <div className="space-y-4 text-center">
          <SkeletonLine width="w-3/4 sm:w-1/2" className="mx-auto h-8" />
          <SkeletonLine width="w-full sm:w-2/3" className="mx-auto h-4" />
          <div className="flex justify-center gap-3 pt-2">
            <SkeletonBlock className="h-11 w-32 rounded-full" />
            <SkeletonBlock className="h-11 w-32 rounded-full" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} lines={2} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The last resort: a route that redirects, or one whose content cannot be
 * predicted. Still a skeleton rather than a blank screen, still centred and
 * fluid at any width.
 */
export function RouteSkeleton() {
  return (
    <div
      data-testid="skeleton-route"
      className="flex min-h-[60dvh] w-full flex-1 items-center justify-center p-6"
    >
      <div className="w-full max-w-md space-y-3">
        <SkeletonLine width="w-1/2" className="h-5" />
        <SkeletonLine width="w-full" className="h-3" />
        <SkeletonLine width="w-2/3" className="h-3" />
      </div>
    </div>
  );
}
