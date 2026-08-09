import {
  CardSkeleton,
  PageHeaderSkeleton,
  StatTilesSkeleton,
} from "@/components/ui/skeletons/page-skeletons";

/** Performance journal: header, summary tiles, then entry cards. */
export default function JournalLoading() {
  return (
    <main className="page-shell max-w-5xl space-y-5">
      <PageHeaderSkeleton />
      <StatTilesSkeleton />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} lines={2} />
        ))}
      </div>
    </main>
  );
}
