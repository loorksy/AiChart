import { ConsolePageSkeleton } from "@/components/ui/skeletons/page-skeletons";

/** Balance tiles, then the statement rows. */
export default function ConsoleBillingLoading() {
  return <ConsolePageSkeleton shape="rows" withTiles maxWidth="max-w-4xl" />;
}
