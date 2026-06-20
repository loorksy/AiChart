import { SkeletonBlock, SkeletonLine } from "@/components/ui/skeleton";

function TradesRowSkeleton() {
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

export default function ConsoleTradesLoading() {
  return (
    <main className="page-shell max-w-5xl space-y-5">
      <div>
        <SkeletonLine width="w-24" className="h-6 mb-1" />
        <SkeletonLine width="w-48" className="h-3.5" />
      </div>
      {/* Filter tabs */}
      <div className="flex gap-2">
        {[1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      {/* Trade rows */}
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <TradesRowSkeleton key={i} />
        ))}
      </div>
    </main>
  );
}
