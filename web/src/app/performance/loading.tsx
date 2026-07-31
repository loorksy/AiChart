import { SkeletonBlock, SkeletonLine } from "@/components/ui/skeleton";

function CardSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <SkeletonLine width="w-24" className="h-4" />
        <SkeletonBlock className="h-5 w-14 rounded-full" />
      </div>
      <SkeletonBlock className="h-2 w-full rounded-full" />
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-10 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function TradeRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <SkeletonBlock className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="flex-1 space-y-1.5">
        <SkeletonLine width="w-28" className="h-3.5" />
        <SkeletonLine width="w-20" className="h-2.5" />
      </div>
      <SkeletonBlock className="h-6 w-16 rounded-md" />
    </div>
  );
}

/** Mirrors the unified page: jump pills → rec cards → trade rows → stat tiles. */
export default function PerformanceLoading() {
  return (
    <main className="page-shell max-w-6xl space-y-8">
      {/* Section jump pills */}
      <div className="flex gap-1.5 rounded-xl border border-border/60 bg-background/85 p-1.5">
        {[1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-8 w-28 rounded-lg" />
        ))}
      </div>
      {/* Recommendations */}
      <section className="space-y-3">
        <SkeletonLine width="w-32" className="h-5" />
        <div className="grid gap-3 md:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </section>
      {/* Trades */}
      <section className="space-y-3">
        <SkeletonLine width="w-24" className="h-5" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <TradeRowSkeleton key={i} />
          ))}
        </div>
      </section>
      {/* Statistics tiles */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SkeletonLine width="w-28" className="h-5" />
          <SkeletonBlock className="h-9 w-56 rounded-lg" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
      </section>
    </main>
  );
}
