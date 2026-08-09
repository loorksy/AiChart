import { SkeletonBlock, SkeletonLine } from "@/components/ui/skeleton";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";

/** One plan: lifecycle bar, level ladder, then the evidence blocks. */
export default function RecommendationDetailLoading() {
  return (
    <main className="page-shell max-w-3xl space-y-4">
      <SkeletonLine width="w-32" className="h-5" />
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <SkeletonLine width="w-28" className="h-4" />
          <SkeletonBlock className="h-5 w-16 rounded-full" />
        </div>
        {/* Lifecycle progress bar */}
        <SkeletonBlock className="h-2 w-full rounded-full" />
        {/* Entry / stop / targets ladder */}
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <SkeletonBlock key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      </div>
      <CardSkeleton lines={4} />
      <CardSkeleton lines={3} />
    </main>
  );
}
