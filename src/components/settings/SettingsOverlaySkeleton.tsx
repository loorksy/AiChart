import { SkeletonBlock } from "@/components/ui/skeleton";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";

/** Same chrome as the settings overlay: title bar, section rail, then the card. */
export function SettingsOverlaySkeleton() {
  return (
    <>
      <div className="fixed inset-0 z-[120] bg-black/60" aria-hidden />
      <div className="fixed inset-0 z-[121] flex flex-col overflow-hidden bg-background sm:m-auto sm:h-[85vh] sm:w-[min(48rem,92vw)] sm:rounded-[var(--radius-lg)] sm:border sm:border-border">
        <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
          <SkeletonBlock className="h-5 w-28" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="flex shrink-0 gap-2 overflow-hidden border-b border-border p-2 sm:w-52 sm:flex-col sm:border-b-0 sm:border-e">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-11 w-28 shrink-0 rounded-lg sm:w-full" />
            ))}
          </div>
          <div className="min-h-0 flex-1 p-4">
            <CardSkeleton lines={4} />
          </div>
        </div>
      </div>
    </>
  );
}
