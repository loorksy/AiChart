import {
  CardSkeleton,
  PageHeaderSkeleton,
  StatTilesSkeleton,
} from "@/components/ui/skeletons/page-skeletons";
import { SkeletonBlock } from "@/components/ui/skeleton";

/** Reports: header, summary tiles, a chart block, then report cards. */
export default function ReportsLoading() {
  return (
    <main className="page-shell max-w-5xl space-y-5">
      <PageHeaderSkeleton withAction />
      <StatTilesSkeleton />
      <SkeletonBlock className="h-48 w-full rounded-xl" />
      <div className="grid gap-3 md:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </main>
  );
}
