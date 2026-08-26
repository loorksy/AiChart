import { ChatLayoutSkeleton } from "@/components/ui/skeletons/page-skeletons";

/**
 * Support IS the agent chat surface, so it loads as one: thread bubbles and
 * the docked composer — not a page header + rows that no longer exist here.
 */
export default function ConsoleSupportLoading() {
  return <ChatLayoutSkeleton />;
}
