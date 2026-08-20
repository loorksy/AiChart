import { SkeletonBlock } from "@/components/ui/skeleton";

/** The embed is one full-frame chart; its skeleton is the same single frame. */
export default function EmbedChartLoading() {
  return (
    <div className="h-dvh w-full p-2">
      <SkeletonBlock className="h-full w-full" />
    </div>
  );
}
