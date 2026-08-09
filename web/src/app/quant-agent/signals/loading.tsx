import { ListRowSkeleton, PageHeaderSkeleton } from "@/components/ui/skeletons/page-skeletons";

/** Signal log: header, the decision filter row, then one row per fired signal. */
export default function QuantAgentSignalsLoading() {
  return (
    <main className="page-shell max-w-6xl space-y-5">
      <PageHeaderSkeleton />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <ListRowSkeleton key={i} />
        ))}
      </div>
    </main>
  );
}
