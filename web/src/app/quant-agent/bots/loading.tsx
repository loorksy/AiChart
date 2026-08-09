import { CardSkeleton, FormSkeleton, PageHeaderSkeleton } from "@/components/ui/skeletons/page-skeletons";

/** Bots page: header, the simulation banner, the config form, then the ladder. */
export default function QuantAgentBotsLoading() {
  return (
    <main className="page-shell max-w-6xl space-y-5">
      <PageHeaderSkeleton withAction />
      <CardSkeleton lines={2} />
      <FormSkeleton fields={4} />
      <CardSkeleton lines={5} />
    </main>
  );
}
