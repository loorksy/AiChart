import { CardSkeleton, PageHeaderSkeleton } from "@/components/ui/skeletons/page-skeletons";

/** Quant Agent feed: header, then recommendation cards. */
export default function QuantAgentLoading() {
  return (
    <main className="page-shell max-w-6xl space-y-5">
      <PageHeaderSkeleton withAction />
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} lines={3} />
        ))}
      </div>
    </main>
  );
}
