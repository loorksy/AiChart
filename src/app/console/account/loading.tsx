import { SkeletonBlock, SkeletonCircle, SkeletonLine } from "@/components/ui/skeleton";
import {
  CardSkeleton,
  PageHeaderSkeleton,
} from "@/components/ui/skeletons/page-skeletons";

/** Account: header, identity card, then plan/details cards. */
export default function AccountLoading() {
  return (
    <main className="page-shell max-w-3xl space-y-5">
      <PageHeaderSkeleton />
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
        <SkeletonCircle size="lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonLine width="w-40" className="h-4" />
          <SkeletonLine width="w-56" className="h-3" />
          <SkeletonBlock className="h-5 w-20 rounded-full" />
        </div>
      </div>
      <CardSkeleton lines={3} />
      <CardSkeleton lines={2} />
    </main>
  );
}
