import { SkeletonBlock } from "@/components/ui/skeleton";
import {
  CardSkeleton,
  PageHeaderSkeleton,
} from "@/components/ui/skeletons/page-skeletons";

/** Settings: header, the tab row, then the active tab's card. */
export default function SettingsLoading() {
  return (
    <main className="page-shell max-w-6xl space-y-5">
      <PageHeaderSkeleton />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-11 w-28 shrink-0 rounded-lg" />
        ))}
      </div>
      <CardSkeleton lines={4} />
    </main>
  );
}
