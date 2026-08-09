import { cn } from "@/lib/utils";

export function PillButton({
  children,
  onClick,
  disabled,
  variant = "outline",
  className,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline" | "ghost";
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition",
        variant === "primary" &&
          "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50",
        variant === "outline" &&
          "border border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground disabled:opacity-50",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
