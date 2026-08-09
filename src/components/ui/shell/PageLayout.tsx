import { cn } from "@/lib/utils";

const MAX_WIDTH = {
  lg: "max-w-lg",
  "2xl": "max-w-2xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  full: "max-w-full",
} as const;

export function PageLayout({
  title,
  subtitle,
  children,
  className,
  maxWidth = "5xl",
  actions,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  maxWidth?: keyof typeof MAX_WIDTH;
  actions?: React.ReactNode;
}) {
  const hasHeader = title || subtitle || actions;

  return (
    <main
      className={cn(
        "page-shell",
        MAX_WIDTH[maxWidth],
        hasHeader ? "space-y-5" : "space-y-4",
        className,
      )}
    >
      {hasHeader && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {title && <h1 className="page-title">{title}</h1>}
            {subtitle && <p className="page-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </main>
  );
}

export function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cn("section-title", className)}>{children}</h2>
  );
}
