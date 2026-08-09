import { ChartPreviewSkeleton } from "@/components/ui/skeletons/page-skeletons";

export default function ChartLoading() {
  return (
    <div className="flex h-dvh flex-col p-2">
      <ChartPreviewSkeleton className="h-full flex-1" />
    </div>
  );
}
