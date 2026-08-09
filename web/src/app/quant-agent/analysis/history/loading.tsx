import { ListRowSkeleton, PageHeaderSkeleton } from "@/components/ui/skeletons/page-skeletons";

/** Analysis history: header, then one row per past analysis. */
export default function QuantAgentAnalysisHistoryLoading() {
  return (
    <main className="page-shell max-w-6xl space-y-5">
      <PageHeaderSkeleton withAction />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <ListRowSkeleton key={i} />
        ))}
      </div>
    </main>
  );
}
