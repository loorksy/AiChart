import {
  ListRowSkeleton,
  PageHeaderSkeleton,
} from "@/components/ui/skeletons/page-skeletons";
import { SkeletonBlock } from "@/components/ui/skeleton";

/** Market page: header, filter pills, then instrument rows. */
export default function MarketLoading() {
  return (
    <main className="page-shell max-w-5xl space-y-5">
      <PageHeaderSkeleton />
      <div className="flex gap-2">
        {[1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <ListRowSkeleton key={i} />
        ))}
      </div>
    </main>
  );
}
