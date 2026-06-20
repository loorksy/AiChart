import { cn } from "@/lib/utils";

/* ─────────────────── Skeleton Primitives ─────────────────── */

/**
 * A shimmering block that adapts to any width/height via className.
 * The base building-block for all composite skeletons.
 */
export function SkeletonBlock({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-xl bg-muted",
        className,
      )}
    />
  );
}

/**
 * A single text-line placeholder with default height.
 */
export function SkeletonLine({
  className,
  width,
}: {
  className?: string;
  /** Tailwind width class, e.g. "w-3/4" */
  width?: string;
}) {
  return (
    <div
      className={cn(
        "h-3.5 animate-pulse rounded-md bg-muted",
        width ?? "w-full",
        className,
      )}
    />
  );
}

/**
 * A circular avatar/icon placeholder.
 */
export function SkeletonCircle({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm"
      ? "h-8 w-8"
      : size === "lg"
        ? "h-14 w-14"
        : "h-10 w-10";

  return (
    <div
      className={cn(
        "animate-pulse rounded-full bg-muted",
        dim,
        className,
      )}
    />
  );
}
