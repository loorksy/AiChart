import { RouteSkeleton } from "@/components/ui/skeletons/page-skeletons";

/**
 * This route resolves to a redirect, so its own frame is on screen only while
 * the destination is worked out — but never as a blank one.
 */
export default function ConsoleMcpLoading() {
  return <RouteSkeleton />;
}
