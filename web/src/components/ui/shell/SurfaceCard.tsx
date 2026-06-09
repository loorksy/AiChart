import { cn } from "@/lib/utils";

export function SurfaceCard({
  children,
  className,
  padding = "md",
}: {
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
}) {
  const pad =
    padding === "none"
      ? ""
      : padding === "sm"
        ? "p-3"
        : padding === "lg"
          ? "p-6"
          : "p-4";

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground",
        pad,
        className,
      )}
    >
      {children}
    </div>
  );
}
