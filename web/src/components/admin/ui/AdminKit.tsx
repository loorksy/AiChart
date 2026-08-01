import * as React from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronsUpDown,
  Inbox,
  Info,
  Loader2,
} from "lucide-react";

import { SkeletonLine } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The admin console's layout system — page shell, section header, card anatomy,
 * table anatomy, form anatomy — in one module so twelve panels cannot drift into
 * twelve different paddings, header weights and empty states.
 *
 * Everything here is presentational and leans on the foundation utilities that
 * already exist in globals.css (`focus-ring`, `tap-target`, `motion-*`,
 * `type-*`). Nothing re-implements a token, and every animation inherits the
 * reduced-motion clamp those utilities carry.
 *
 * No `"use client"` on purpose: this is a shared module, so a panel that is
 * rendered on the server can use the static pieces while the interactive panels
 * pull it into their own client bundle.
 */

/* ══════════════════════════ page shell ══════════════════════════ */

export function AdminPage({
  children,
  className,
  width = "wide",
  ...rest
}: React.ComponentProps<"section"> & {
  /** narrow = a settings/form column; wide = data. */
  width?: "narrow" | "wide" | "full";
}) {
  return (
    <section
      className={cn(
        // The section mounts fresh on every ?tab= change, so the entrance
        // animation *is* the section transition — no extra state needed.
        "motion-fade-in mx-auto flex w-full min-w-0 flex-col gap-5 px-3 sm:gap-6 sm:px-0",
        width === "narrow"
          ? "max-w-3xl"
          : width === "full"
            ? "max-w-none"
            : "max-w-6xl",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

/** Title + one line of "what this screen is for" + the screen's own actions. */
export function SectionHeader({
  title,
  description,
  actions,
  icon: Icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="type-title flex items-center gap-2">
          {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0">{title}</span>
        </h2>
        {description && (
          <p className="type-caption max-w-prose text-pretty">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/* ══════════════════════════ card anatomy ══════════════════════════ */

export function AdminCard({
  className,
  ...rest
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground",
        className,
      )}
      {...rest}
    />
  );
}

/**
 * A card's header is a fixed rhythm: title (+ optional description) on the
 * inline-start, actions on the inline-end, one hairline below.
 */
export function AdminCardHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {(title || description) && (
        <div className="min-w-0 space-y-0.5">
          {title && <h3 className="type-subheading truncate">{title}</h3>}
          {description && <p className="type-caption">{description}</p>}
        </div>
      )}
      {children}
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}

export function AdminCardBody({ className, ...rest }: React.ComponentProps<"div">) {
  return <div className={cn("px-4 py-4", className)} {...rest} />;
}

export function AdminCardFooter({
  className,
  ...rest
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-border bg-muted/20 px-4 py-3",
        className,
      )}
      {...rest}
    />
  );
}

/* ══════════════════════════ stats ══════════════════════════ */

export type StatTone = "neutral" | "positive" | "negative" | "warning";

const STAT_VALUE_TONE: Record<StatTone, string> = {
  neutral: "text-foreground",
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
};

export function StatGrid({
  className,
  columns = 4,
  ...rest
}: React.ComponentProps<"div"> & { columns?: 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3",
        columns === 2
          ? "sm:grid-cols-2"
          : columns === 3
            ? "sm:grid-cols-3"
            : "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
      {...rest}
    />
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  index = 0,
  className,
  ...rest
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: StatTone;
  /** Position in the row — drives the staggered entrance. */
  index?: number;
}) {
  return (
    <div
      style={{ "--motion-index": index } as React.CSSProperties}
      className={cn(
        "motion-rise-in motion-stagger min-w-0 rounded-xl border border-border bg-card p-4",
        className,
      )}
      {...rest}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="type-caption truncate">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      </div>
      <p
        dir="ltr"
        className={cn(
          "type-numeric mt-1.5 text-start text-2xl font-bold",
          STAT_VALUE_TONE[tone],
        )}
      >
        {value}
      </p>
      {hint && <p className="type-caption mt-0.5 text-xs">{hint}</p>}
    </div>
  );
}

/* ══════════════════════════ feedback ══════════════════════════ */

export type AlertTone = "ok" | "error" | "info" | "warning";

const ALERT_STYLES: Record<AlertTone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-border bg-muted/40 text-foreground",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

const ALERT_ICONS: Record<AlertTone, React.ComponentType<{ className?: string }>> = {
  ok: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertCircle,
};

/**
 * One inline message component for every panel. An error is `role="alert"` so a
 * screen reader is interrupted by a failed save; anything else is a polite
 * `role="status"`.
 */
export function InlineAlert({
  tone = "info",
  children,
  className,
}: {
  tone?: AlertTone;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = ALERT_ICONS[tone];
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "motion-fade-in flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        ALERT_STYLES[tone],
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** The "nothing here yet" state — never a bare sentence in a blank box. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon className="size-5" />
      </span>
      <p className="type-subheading">{title}</p>
      {description && (
        <p className="type-caption max-w-sm text-pretty">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Spinner for a pending action. Inherits the reduced-motion clamp. */
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      aria-hidden
      className={cn(
        "size-3.5 animate-spin motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/* ══════════════════════════ table anatomy ══════════════════════════ */

/**
 * The horizontal scroll container every admin table lives in. Below 640px a
 * wide table stays a scrollable table rather than a squashed grid; panels that
 * can express a row as a card render `<RecordCard>` instead and hide this.
 *
 * `maxHeight` (a Tailwind class such as `max-h-[32rem]`) turns the container
 * into a vertical scroller, which is what makes `stickyHeader` on the `thead`
 * actually stick — without a bounded height there is nothing to scroll past.
 */
export function TableWrap({
  children,
  className,
  maxHeight,
}: {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div
      className={cn(
        "relative w-full overflow-x-auto",
        maxHeight && `overflow-y-auto ${maxHeight}`,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AdminTable({ className, ...rest }: React.ComponentProps<"table">) {
  return (
    <table
      className={cn("w-full border-collapse text-start text-sm", className)}
      {...rest}
    />
  );
}

export function THead({
  className,
  sticky = false,
  ...rest
}: React.ComponentProps<"thead"> & { sticky?: boolean }) {
  return (
    <thead
      className={cn(
        "text-muted-foreground",
        // A sticky header must be fully opaque — a translucent tint would let
        // the rows scroll visibly through it. z-raised keeps it above row
        // content and below the console header.
        sticky
          ? "sticky top-0 z-raised bg-muted shadow-[0_1px_0_0_var(--border)]"
          : "bg-muted/40",
        className,
      )}
      {...rest}
    />
  );
}

export function Th({
  className,
  numeric = false,
  ...rest
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-10 whitespace-nowrap px-3 text-start align-middle text-xs font-medium",
        numeric && "text-end",
        className,
      )}
      {...rest}
    />
  );
}

export type SortDir = "asc" | "desc";

export function ariaSortValue(
  active: boolean,
  dir: SortDir,
): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

/**
 * A sortable header cell. `aria-sort` belongs on the `th`, the click target is
 * the button inside it — putting the handler on the cell would leave the column
 * unreachable by keyboard.
 */
export function SortTh({
  label,
  active,
  dir,
  onToggle,
  numeric = false,
  className,
}: {
  label: React.ReactNode;
  active: boolean;
  dir: SortDir;
  onToggle: () => void;
  numeric?: boolean;
  className?: string;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Th aria-sort={ariaSortValue(active, dir)} numeric={numeric} className={className}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "focus-ring tap-target-expand -mx-1 inline-flex items-center gap-1.5 rounded px-1 py-1 transition-colors duration-150 ease-out hover:text-foreground",
          numeric && "flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span>{label}</span>
        <Icon className="size-3 shrink-0" aria-hidden />
      </button>
    </Th>
  );
}

export function Tr({ className, ...rest }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-border/60 transition-colors duration-150 ease-out last:border-0 hover:bg-muted/40",
        className,
      )}
      {...rest}
    />
  );
}

export function Td({
  className,
  numeric = false,
  ...rest
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle",
        numeric && "type-numeric text-end",
        className,
      )}
      {...rest}
    />
  );
}

/** The empty state, sized to the table so it is centred under the header. */
export function TableEmptyRow({
  colSpan,
  title,
  description,
  icon,
  action,
}: {
  colSpan: number;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <EmptyState
          icon={icon}
          title={title}
          description={description}
          action={action}
        />
      </td>
    </tr>
  );
}

/** Loading rows that keep the table's own geometry instead of a spinner. */
export function TableSkeletonRows({
  rows = 5,
  cols,
}: {
  rows?: number;
  cols: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-border/60 last:border-0">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-3 py-3">
              <SkeletonLine width={c === 0 ? "w-40" : "w-16"} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ══════════════════════════ mobile record card ══════════════════════════ */

/**
 * The sub-640px form of a table row: a labelled card, not a squashed grid.
 * Panels render this list and the table side by side and let the breakpoint
 * choose, so both stay in sync with one data map.
 */
export function RecordCard({
  title,
  subtitle,
  badge,
  fields,
  actions,
  index = 0,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  fields?: { label: React.ReactNode; value: React.ReactNode }[];
  actions?: React.ReactNode;
  index?: number;
  className?: string;
}) {
  return (
    <div
      style={{ "--motion-index": index } as React.CSSProperties}
      className={cn(
        "motion-rise-in motion-stagger rounded-xl border border-border bg-card p-3.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          {subtitle && (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>

      {fields && fields.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          {fields.map((field, i) => (
            <div key={i} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{field.label}</dt>
              <dd className="truncate text-sm text-foreground">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {actions && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-3">
          {actions}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════ form anatomy ══════════════════════════ */

/**
 * Label above, control, then exactly one of hint or error below. The caller
 * wires `aria-describedby={describedBy(id, {hint, error})}` and `aria-invalid`
 * on the control itself — the ids are derived from `htmlFor` so they cannot
 * drift.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  suffix,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  /** Right-hand slot on the label line — a status badge, a unit, a counter. */
  suffix?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
          {required && (
            <span className="ms-1 text-destructive" aria-hidden>
              *
            </span>
          )}
        </label>
        {suffix}
      </div>
      {children}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="flex items-start gap-1.5 text-xs text-destructive"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Matches `Field`'s id convention so the control's description never drifts. */
export function describedBy(
  htmlFor: string,
  state: { hint?: unknown; error?: unknown },
): string | undefined {
  if (state.error) return `${htmlFor}-error`;
  if (state.hint) return `${htmlFor}-hint`;
  return undefined;
}

/* ══════════════════════════ sorting ══════════════════════════ */

/**
 * Column sort state. Clicking the active column flips direction; clicking a new
 * one starts at `desc`, because every sortable admin column is a "most X first"
 * question (newest event, biggest spend, highest usage).
 */
export function useAdminSort<K extends string>(
  initialKey: K,
  initialDir: SortDir = "desc",
) {
  const [key, setKey] = React.useState<K>(initialKey);
  const [dir, setDir] = React.useState<SortDir>(initialDir);

  const toggle = React.useCallback(
    (next: K) => {
      if (next === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setKey(next);
        setDir("desc");
      }
    },
    [key],
  );

  const sortProps = React.useCallback(
    (columnKey: K) => ({
      active: columnKey === key,
      dir,
      onToggle: () => toggle(columnKey),
    }),
    [dir, key, toggle],
  );

  return { key, dir, toggle, sortProps };
}

/** `asc`/`desc` sign for a comparator, so panels never re-derive it. */
export function sortSign(dir: SortDir): 1 | -1 {
  return dir === "asc" ? 1 : -1;
}
