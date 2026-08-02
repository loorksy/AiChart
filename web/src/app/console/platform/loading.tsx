import { ConsolePageSkeleton } from "@/components/ui/skeletons/page-skeletons";

/** Admin console: tabs, tiles, then the panel's table. */
export default function ConsolePlatformLoading() {
  return <ConsolePageSkeleton shape="table" withTiles withTabs maxWidth="max-w-6xl" />;
}
