import { CardSkeleton, FormSkeleton, PageHeaderSkeleton } from "@/components/ui/skeletons/page-skeletons";

/** Analysis page: header, the symbol/timeframe/run row, then the report body. */
export default function QuantAgentAnalysisLoading() {
  return (
    <main className="page-shell max-w-6xl space-y-5">
      <PageHeaderSkeleton withAction />
      <FormSkeleton fields={2} />
      <CardSkeleton lines={4} />
      <CardSkeleton lines={3} />
    </main>
  );
}
